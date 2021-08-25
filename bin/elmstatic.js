#!/usr/bin/env node
const Chokidar = require("chokidar")
const { Feed } = require("feed")
const Fs = require("fs-extra")
const Glob = require("glob")
const Path = require("path")
const R = require("ramda")
const WorkerPool = require("workerpool")
const extractFrontmatter = require("front-matter")
const flags = require("commander")
const removeMarkdown = require("remove-markdown")
const { spawn } = require("cross-spawn")

// () -> Config/Effects
function readConfig() {
    try {
        Fs.accessSync("config.json", Fs.constants.R_OK)
    }
    catch (err) {
        throw new Error("Couldn't find config.json. Is this a new project? Run `elmstatic init` to generate a scaffold.")
    }

    const config = JSON.parse(Fs.readFileSync("config.json").toString())
    const allowedTags = R.map(R.toLower, R.defaultTo([], config.tags))
    return R.mergeRight(config, { allowedTags })
}

// String -> [String] -> String/Effects
function buildLayouts(elmPath, layouts) {
    const layoutFileNames = R.map((layout) => Path.join("_layouts", layout + ".elm"), layouts)
    const command = R.isNil(elmPath) ? "elm" : elmPath
    const args = ["make", layoutFileNames, "--optimize", "--output", "elm.js"]

    log.info(`  $ ${command} ${R.flatten(args).join(" ")}`)
    const res = spawn.sync(command, R.flatten(args), { stdio: 'inherit' })
    if (res.status == 1) {  // This indicates a compiler error
        throw new Error("")
    }
    else if (!R.isNil(res.error) && res.error.errno == "ENOENT") {
        throw new Error(`Couldn't find the Elm executable (${res.error.path})`)
    }
    else
        return Fs.readFileSync("elm.js").toString()
}

// String -> String
function dropExtension(fileName) {
    return R.slice(0, R.lastIndexOf(".", fileName), fileName)
}

// String -> String
const appendTitle = R.curry((title, s) => R.isNil(title) || R.isEmpty(title) ? s : s + " | " + title)

// String -> {[<key>: String] }
function parseMarkdown(contents) {
    const { attributes, body } = extractFrontmatter(contents)
    const excerpt = R.pipe(removeMarkdown, R.slice(0, 500), R.concat(R.__, "..."))(body)
    return R.mergeRight(attributes, {excerpt, markdown: body})
}

// String -> {[<key>: String]}
function parseElmMarkupPreamble(contents) {
    const layoutMatches = R.match(/\|>\s*Metadata\s*\n/, contents)
    if (R.isEmpty(layoutMatches)) {
        return {}
    }
    else {
        const lineSeparator = R.endsWith("\r\n", layoutMatches[0]) ? "\r\n" : "\n"
        const endOfPreamble = R.match(new RegExp(lineSeparator + "\\s*" + lineSeparator), contents)
        if (R.isEmpty(endOfPreamble)) {
            return {}
        }
        else {
            return R.pipe(
                R.slice(R.length(layoutMatches[0]), endOfPreamble.index),
                R.split(new RegExp("\\s*" + lineSeparator + "\\s+")),
                R.map(R.pipe(R.split(/\s*=\s*/), R.map(R.trim))),
                R.fromPairs,
                R.mergeAll
            )(contents)
        }
    }
}

// String -> {[<key>: String]}
function parseElmMarkup(contents) {
    const preamble = parseElmMarkupPreamble(contents)
    return R.mergeRight(preamble, { content: contents })
}

// String -> String -> {outputPath: String}
function parsePageFileName(outputPath, pageFileName) {
    return {
        inputPath: Path.join("_pages", pageFileName),
        outputPath: Path.join(outputPath, dropExtension(pageFileName)),
        format: Path.extname(pageFileName) == ".md" ? "md" : "emu"
    }
}

// String -> String/Effects
function readFile(unresolvedFileName) {
    const resolvedFileName = Fs.lstatSync(unresolvedFileName).isSymbolicLink() ?
        Fs.realpathSync(Fs.readlinkSync(unresolvedFileName))
        : unresolvedFileName

    return Fs.readFileSync(resolvedFileName).toString()
}

// [PageConfig] ->  String -> String -> String -> HtmlPage/Effects
const generatePageConfig = R.curry((pages, outputPath, siteTitle, pageFileName) => {
    const mtime = Fs.lstatSync(Path.join("_pages", pageFileName)).mtime
    const ext = Path.extname(pageFileName)
    const existingPage = R.find(R.propEq("pageFileName", pageFileName), pages)

    if (R.isNil(existingPage) || mtime > existingPage.mtime) {
        const contents = readFile(Path.join("_pages", pageFileName))
        let attrs = ext == ".md" ? parseMarkdown(contents) : parseElmMarkup(contents)

        if (!R.isNil(attrs.contentSource)) {
            const transcludedContents = readFile(Path.join("_pages", attrs.contentSource + ext))
            const transcludedAttrs = ext == ".md" ? parseMarkdown(transcludedContents) : parseElmMarkup(transcludedContents)
            attrs = R.mergeRight(attrs, R.pick(["content", "excerpt", "markdown"], transcludedAttrs))
        }
        else
            ; // Do nothing - the file doesn't link to another file's content

        return R.pipe(
            R.mergeRight(R.__, attrs),
            R.mergeRight({ siteTitle: appendTitle(siteTitle, attrs.title) }),
            R.mergeRight(parsePageFileName(outputPath, pageFileName))
        )({ layout: "Page", mtime, pageFileName })
    }
    else
        return existingPage
})

// [PageConfig] -> String -> String -> [String] -> [HtmlPage]/Effects
function generatePageConfigs(pages, outputPath, siteTitle, pageFileNames) {
    return R.map(generatePageConfig(pages, outputPath, siteTitle), pageFileNames)
}

// String -> [PageOrPostConfig] -> Promise [HtmlPage]/Effects
function generatePages(elmJs, pages) {
    const pagePromise = (page) => {
        if (R.isNil(page.html)) {
            log.info("    Generating " + page.outputPath)
            return workerPool.exec(generateHtml, [elmJs, page]).then((html) => R.mergeRight(page, {html}))
        }
        else 
            return Promise.resolve(page)
    }
            
    return Promise.all(R.map(pagePromise, pages))
}

// String -> String -> {[<key>: Any]}
function parsePostFileName(outputPath, postFileName) {
    const dirName = Path.dirname(postFileName)
    const section = R.equals(dirName, "posts") ? ""
        : R.slice(R.lastIndexOf(Path.sep, dirName) + 1, R.length(dirName), dirName)

    if (dropExtension(Path.basename(postFileName)) == "index") {
        return { isIndex: true, section, inputPath: postFileName, outputPath: Path.join(outputPath, dirName) }
    }
    else {
        const date = R.take(10, Path.basename(postFileName))
        const slug = R.pipe(Path.basename, R.drop(11), dropExtension)(postFileName)
        const link = Path.join(dirName, date + "-" + slug)
        const format = Path.extname(postFileName) == ".md" ? "md" : "emu"

        return { isIndex: false, date, slug, link, format, section, inputPath: postFileName, outputPath: Path.join(outputPath, link) }
    }
}

// String|Object -> [String]|Object
const strToArray = (tags) => R.is(String, tags) ? R.split(/\s+/, tags) : R.defaultTo([], tags)

// [PostConfig] -> String -> String -> [String] -> Bool -> [String] -> [PostHtmlPage]/Effects
function generatePostConfigs(posts, outputPath, siteTitle, allowedTags, includeDrafts, postFileNames) {
    const draftFilter = includeDrafts ? R.identity :
        (postConfig) => postConfig.isIndex || new Date(postConfig.date) <= new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000)

    const postConfigs = R.pipe(
        R.map((postFileName) => {
            const mtime = Fs.lstatSync(Fs.realpathSync(postFileName)).mtime
            const ext = Path.extname(postFileName)
            const existingPost = R.find(R.propEq("postFileName", postFileName), posts)

            if (R.isNil(existingPost) || mtime > existingPost.mtime || existingPost.isIndex) {
                const outputFileName = R.tail(postFileName)  // Remove leading underscore 
                const contents = Fs.readFileSync(Fs.realpathSync(postFileName)).toString()
                const attrs = R.pipe(
                    ext == ".md" ? parseMarkdown : parseElmMarkup,
                    R.evolve({ tags: R.pipe(strToArray, R.map(R.trim), R.reject(R.isEmpty)) })
                )(contents)
                const fileNameAttrs = parsePostFileName(outputPath, outputFileName)

                if (!R.isEmpty(allowedTags) && !R.isNil(attrs.tags)) {
                    const invalidTags = R.difference(R.map(R.toLower, attrs.tags), allowedTags)
                    if (!R.isEmpty(invalidTags))
                        throw new Error(`Error in ${postFileName}:\nUndeclared tags: [${invalidTags.join(", ")}]\nYou can declare tags in config.json`)
                    else
                        ; // All post tags are valid
                }
                else
                    ; // Don't do tag validation if allowed tags are not defined or the post has no tags

                return R.pipe(
                    R.mergeRight(R.__, attrs),
                    R.mergeRight({ siteTitle: appendTitle(siteTitle, attrs.title) }),
                    R.evolve({
                        tags: R.pipe(R.append(fileNameAttrs.section), R.reject(R.isEmpty))
                    }),
                    R.mergeRight(fileNameAttrs)
                )({ layout: fileNameAttrs.isIndex ? "Posts" : "Post", mtime, postFileName })
            }
            else
                return existingPost
        })
        , R.filter(draftFilter)
    )(postFileNames)

    return R.map((postConfig) => {
        if (postConfig.isIndex) {
            const filter = R.isEmpty(postConfig.section) ?
                R.identity : R.propEq("section", postConfig.section)
            return R.mergeRight(postConfig,
                { posts: R.filter(R.both(filter, R.propEq("isIndex", false)), postConfigs) })
        }
        else {
            return postConfig
        }
    }, postConfigs)
}

// String -> PageConfig | PostConfig -> HtmlString
// Executed in the context of a worker, hence needs its own `require`s
function generateHtml(elmJs, pageOrPost) {
    const JsDom = require("jsdom").JSDOM
    const R = require("ramda")
    const { Script } = require("vm")

    const script = new Script(`
    ${elmJs}; let app = Elm.${pageOrPost.layout}.init({flags: ${JSON.stringify(pageOrPost)}})
    `)
    const dom = new JsDom(`<!DOCTYPE html><html><body></body></html>`, {
        runScripts: "outside-only"
    })
    
    dom.runVMScript(script)
    if (dom.window.document.title == "error")
        throw new Error(`Error in ${pageOrPost.inputPath}:\n${dom.window.document.body.firstChild.attributes[0].value}`)
    else
        return "<!doctype html>" + R.replace(/citatsmle-script/g, "script", dom.window.document.body.innerHTML)
}

// String -> HtmlPage | PostHtmlPage -> ()/Effects
function writeHtmlPage(page) {
    const outputPath = R.endsWith("index", page.outputPath) ?
        page.outputPath + ".html" : Path.join(page.outputPath, "index.html")
    Fs.mkdirsSync(Path.dirname(outputPath))
    Fs.writeFileSync(outputPath, page.html)
}

// [PostHtmlPage] -> [String]
const extractTags = R.pipe(
    R.map(R.pipe(R.prop("tags"), R.defaultTo([]))),
    R.flatten,
    R.uniq
)

// String -> [PostHtmlPage] -> [PostHtmlPage]
function getPostsWithTag(tag, posts) {
    const filter = (post) => {
        return !post.isIndex && R.pipe(R.defaultTo([]), R.map(R.toLower), R.contains(R.toLower(tag)))(post.tags)
    }
    return R.filter(filter, posts)
}
    
// String -> String -> [PostHtmlPage] -> Promise [TagPage]
function generateTagPages(elmJs, outputPath, siteTitle, posts) {
    return Promise.all(R.pipe(
        extractTags,
        R.map((tag) => ({
            layout: "Tag",
            markdown: "",
            outputPath: Path.join(outputPath, "tags", tag),
            posts: getPostsWithTag(tag, posts), 
            section: "",
            siteTitle: appendTitle(siteTitle, "Tag: " + tag),
            tag,
            title: "Tag: " + tag
        })),
        R.map((page) => {
            log.info("    Generating " + page.outputPath)
            return workerPool.exec(generateHtml, [elmJs, page]).then((html) => R.mergeRight(page, {html}))
        })
    )(posts))
}

// [PostHtmlPage] -> [String]
const extractSections = R.pipe(
    R.map(R.prop("section")),
    R.reject(R.isEmpty),
    R.uniq
)

// Path -> FeedConfig -> [PostHtmlPage] -> ()/Effects
function generateFeed(outputPath, config, posts) {
    let feed = new Feed(config)

    R.forEach((post) => {
        const section = R.isEmpty(post.section) || config.isSectionFeed ? "" : post.section + "/"
        const id = config.link + "/" + section + post.date + "-" + post.slug
        feed.addItem({
            title: post.title,
            id: id,
            link: id,
            description: post.description || post.excerpt,
            author: [config.author],
            date: new Date(post.date)
        })
    }, posts)

    const feedType = config.type || "rss"
    const fileName = { atom: "atom.xml", json: "feed.json", rss: "rss.xml" }
    const feedFunc = { atom: feed.atom1, json: feed.json1, rss: feed.rss2 }

    log.info(`    Writing ${Path.join(outputPath, fileName[feedType])}`)
    Fs.writeFileSync(Path.join(outputPath, fileName[feedType]), feedFunc[feedType]())
}

// String -> [PostHtmlPage] -> ()/Effects
function generateFeeds(feedConfig, outputPath, posts) {
    const sections = extractSections(posts)
    generateFeed(outputPath, R.mergeRight(feedConfig, { isSectionFeed: false }), posts)

    R.forEach((section) => {
        const sectionPath = Path.join(outputPath, section)
        Fs.mkdirsSync(sectionPath)
        generateFeed(
            sectionPath,
            R.evolve({
                title: R.concat(R.__, `/${section}`),
                id: R.concat(R.__, `/${section}`),
                link: R.concat(R.__, `/${section}`)
            }, R.mergeRight(feedConfig, { isSectionFeed: true })),
            getPostsWithTag(section, posts))
    }, sections)
}

// DuplicateConfig -> String -> ()/Effects
function duplicatePages(config, outputPath) {
    R.forEachObjIndexed((dest, source) => {
        Fs.copySync(Path.join(outputPath, source), Path.join(outputPath, dest))
    }, config)
}

// String -> ()/Effects
function copyResources(outputPath) {
    if (Fs.pathExistsSync("_resources"))
        Fs.copySync("_resources", outputPath)
    else
        ; // Do nothing - resources directory not present
}

// [PageConfig] -> [PostConfig] -> {includeDrafts: Bool} -> Promise {pages: [HtmlPage], posts: [HtmlPage]}/Effects
function generateEverything(pages, posts, options) {
    // Dependencies between different inputs and outputs look something like this, 
    // (ie to build elm.js we need to read all page/post content to get both 
    // page and post configs), and this could be used to optimise which steps
    // are carried out on a given input change:
    // const buildDependencies = {
    //     config: [],
    //     resources: ["config"],
    //     pageConfigs: ["config"],
    //     postConfigs: ["config"],
    //     elmJs: ["pageConfigs", "postConfigs"],
    //     tagPageConfigs: ["postConfigs"],
    //     feeds: ["postConfigs"],
    //     pages: ["elmJs"],
    //     posts: ["elmJs"],
    //     tagPages: ["elmJs", "tagPageConfigs"],
    //     aliases: ["pages", "posts", "tagPages"]
    // }

    const config = readConfig()

    const newPages = generatePageConfigs(pages, config.outputDir, config.siteTitle, Glob.sync("**/*.*(md|emu)", { cwd: "_pages" }))
    const newPosts = generatePostConfigs(posts, config.outputDir, config.siteTitle,
        config.allowedTags, options.includeDrafts, Glob.sync("_posts/**/*.*(md|emu)"))

    const layouts = R.pipe(
        R.map(R.prop("layout")),
        R.concat(R.isEmpty(newPosts) ? [] : ["Tag"]),
        R.uniq
    )(R.concat(newPages, newPosts))

    log("  Compiling layouts")
    const elmJs = buildLayouts(config.elm, layouts)

    log("  Generating pages and posts")
    return Promise.all([
        generatePages(elmJs, newPages), 
        generatePages(elmJs, newPosts),
        generateTagPages(elmJs, config.outputDir, config.siteTitle, newPosts)
    ])
    .then((result) => {
        [newPagesWithHtml, newPostsWithHtml, tagPages] = result 
        const dotGitPath = Path.join(config.outputDir, ".git")
        const dotGitContent = Fs.pathExistsSync(dotGitPath) ?
            Fs.readFileSync(Path.join(config.outputDir, ".git")).toString() : null
    
        log(`  Cleaning out the output path (${config.outputDir})`)
        Fs.emptyDirSync(config.outputDir)
    
        if (R.is(String, dotGitContent))
            Fs.writeFileSync(dotGitPath, dotGitContent)
        else
            ; // Do nothing, no .git file existed
    
        log("  Writing HTML")
        R.forEach(writeHtmlPage, newPagesWithHtml)
        R.forEach(writeHtmlPage, newPostsWithHtml)
        R.forEach(writeHtmlPage, tagPages)
    
        log("  Generating feeds")
        generateFeeds(config.feed, config.outputDir, R.reject(R.propEq("isIndex", true), newPosts))
        log("  Duplicating pages")
        duplicatePages(config.copy, config.outputDir)
        log("  Copying resources")
        copyResources(config.outputDir)
    
        return { pages: newPagesWithHtml, posts: newPostsWithHtml }
    })
}

// String -> String
function humaniseFsEvent(event) {
    switch (event) {
        case "add":
        case "addDir":
            return "added"
        case "change":
            return "updated"
        case "unlink":
        case "unlinkDir":
            return "deleted"
        default:
            return "generated event " + event
    }
}

// Int -> Function -> Function/Effects
// Accumulate events/paths until the function hasn't been called for <delay> ms, 
// then call `func` with the accumulated array of events/paths. The reason to use 
// this is that chokidar has no notion of rename; instead, there's a pair of 
// `unlink` and `add` events
function debounceFileEvents(delay, func) {
    let timeoutId = null
    let events = []
    return (event, path) => {
        events.push({event, path})
        const later = () => {
            func(events)
            events = []
        }
        if (!R.isNil(timeoutId)) {
            clearTimeout(timeoutId)
        }
        else
            ;  // No timeout yet
        timeoutId = setTimeout(later, delay)
    }
}

function handleError(extraLogMessage) {
    return (err) => {
        if (!R.isEmpty(err.message)) {
            log.error("\n" + err.stack)
        }
        else
            ; // No message means it's an `elm make` error, so it's already printed    

        if (!R.isNil(extraLogMessage)) 
            log(extraLogMessage)
        else
            ; // No extra message to display
    }
}

// {includeDrafts: Bool} -> Promise {pages: [HtmlPage], posts: [HtmlPage]}/Effects
function buildSiteOnce(options) {
    log("Building the site" + (options.includeDrafts ? ", including draft content" : ""))
    return generateEverything([], [], options)
        .then(() => workerPool.terminate())
        .catch(handleError())
}

// {includeDrafts: Bool} -> ()/Effects
function buildSiteAndWatch(options) {
    let pages = [] 
    let posts = [] 

    const watchPaths = ["_layouts", "_pages", "_posts", "_resources", "config.json", "elm.json"]
    let watcher = Chokidar.watch(watchPaths, { ignoreInitial: false, followSymlinks: false })

    watcher.on("all", debounceFileEvents(100, (events) => {
        try {
            R.forEach((e) => { log.info(`${e.path} ${humaniseFsEvent(e.event)}`) }, events)
            const layoutsChanged = R.any(R.pipe(R.prop("path"), R.startsWith("_layouts")), events)
            generateEverything(layoutsChanged ? [] : pages, layoutsChanged ? [] : posts, options)
            .then((result) => {
                pages = result.pages
                posts = result.posts
                log("Ready! Watching for more changes...")
            })
            .catch(handleError("Error! Watching for more changes..."))    
        }
        catch(err) {
            handleError("Error! Watching for more changes...")(err)
        }
    }))
}

// Bool -> ()/Effects
function generateScaffold(options) {
    const files = Fs.readdirSync(".")
    if (R.isEmpty(files) || (R.length(files) == 1 && files[0] == ".git")) {
        log("Generating scaffold")
        Fs.copySync(Path.join(__dirname, "..", "scaffold", options.forElmMarkup ? "emu" : "md"), process.cwd())
    }
    else {
        throw new Error("The directory is not empty. Please run the command in an empty directory.")
    }
}

const log = console.log
log.error = console.error
log.info = () => {}

const workerPool = WorkerPool.pool()

// LogObject -> ()/Effects
const enableVerboseLogging = R.curry((log, isVerbose) => log.info = console.info)


// ACTION STARTS HERE

try {
    flags
        .version(JSON.parse(Fs.readFileSync(Path.join(__dirname, "..", "package.json")).toString()).version)
        .usage(
            `[command] [options]
    -> Elmstatic has to be run from the site directory.
    --> Run elmstatic <command> -h to see command-specific options.
    ---> See https://korban.net/elm/elmstatic for more information.
            `)
        .option("-v, --verbose", "show more information when generating output", enableVerboseLogging(log))

    flags
        .command("init")
        .description("Generate a scaffold for a new site in the current directory")
        .option("--elm-markup", "provide an elm-markup scaffold instead of the default Markdown")
        .action((cmd) => generateScaffold({ forElmMarkup: cmd.elmMarkup }))

    flags
        .command("watch")
        .description("Watch for source file changes and rebuild the site incrementally")
        .option("-d, --drafts", "include draft (future dated) posts")
        .action((cmd) => buildSiteAndWatch({ includeDrafts: cmd.drafts }))

    flags
        .command("build")
        .description("Build the site (runs by default if no command is supplied)")
        .option("-d, --drafts", "include draft (future dated) posts")
        .action((cmd) => buildSiteOnce({ includeDrafts: cmd.drafts }))

    if (process.argv.length < 3)
        buildSiteOnce({ includeDrafts: false })
    else
        flags.parse(process.argv)  // This invokes command & option callbacks 
}
catch (err) {
    handleError()(err)
    process.exitCode = 1
}
