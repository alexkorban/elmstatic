#!/usr/bin/env node
const Chokidar = require("chokidar")
const { Feed } = require("feed")
const Fs = require("fs-extra")
const Glob = require("glob")
const JsDom = require("jsdom").JSDOM
const Path = require("path")
const R = require("ramda")
const { Script } = require("vm")
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
    return R.merge(config, { allowedTags })
}

// String -> String/Effects
function buildLayouts(elmPath) {
    const layouts = R.reject(R.endsWith("Elmstatic.elm"), Glob.sync("_layouts/**/*.elm"))
    const command = R.isNil(elmPath) ? "elm" : elmPath
    const args = ["make", layouts, "--optimize", "--output", "elm.js"]

    log.info(`  $ ${command} ${R.flatten(args).join(" ")}`)
    const res = spawn.sync(command, R.flatten(args), { stdio: 'inherit' })
    if (res.status != 0)
        throw new Error("")
    else
        return Fs.readFileSync("elm.js").toString()
}

// String -> String
function dropExtension(fileName) {
    return R.slice(0, R.lastIndexOf(".", fileName), fileName)
}

// String -> {contentStartIndex: Int, preamble: String}
function extractPreamble(contents) {
    const preambleMarker = "---\n"
    if (!R.startsWith(preambleMarker, contents)) {
        return { contentStartIndex: 0, preamble: "" }
    }
    else {
        const endOfPreamble = contents.indexOf(preambleMarker, R.length(preambleMarker))

        if (endOfPreamble == -1) {
            return { contentStartIndex: 0, preamble: "" }
        }
        else {
            const preamble = R.slice(R.length(preambleMarker), endOfPreamble, contents)
            return { contentStartIndex: endOfPreamble + R.length(preambleMarker), preamble: preamble }
        }
    }
}

// String -> [String, String]
function parsePreambleLine(line) {
    return R.pipe(
        R.splitAt(R.indexOf(":", line)),
        R.evolve({ 1: R.tail }),
        R.map(R.trim)
    )(line)
}

// String -> String
function unquote(s) {
    const startIndex = R.startsWith("\"", s) ? 1 : 0
    const endIndex = R.endsWith("\"", s) ? R.length(s) - 1 : R.length(s)
    return R.slice(startIndex, endIndex, s)
}

// String -> String
const appendTitle = R.curry((title, s) => R.isNil(title) || R.isEmpty(title) ? s : s + " | " + title)

// String -> {[<key>: String]}
const parsePreamble = R.pipe(
    R.split("\n"),
    R.reject(R.isEmpty),
    R.map(parsePreambleLine),
    R.fromPairs
)

// String -> {[<key>: String]}
function parseMarkdown(contents) {
    const { contentStartIndex, preamble } = extractPreamble(contents)
    const contentsWithoutPreamble = R.drop(contentStartIndex, contents)
    const excerpt = R.pipe(removeMarkdown, R.slice(0, 500), R.concat(R.__, "..."))(contentsWithoutPreamble)
    return R.merge(parsePreamble(preamble), { excerpt, markdown: contentsWithoutPreamble })
}

// String -> {[<key>: String]}
function parseElmMarkupPreamble(contents) {
    const layoutMatches = R.match(/\|>\s*Metadata\s*/, contents)
    const endOfPreamble = R.match(/\n\s*\n/, contents)
    if (R.isEmpty(layoutMatches) || R.isEmpty(endOfPreamble)) {
        return {}
    }
    else {
        return R.pipe(
            R.slice(R.length(layoutMatches[0]), endOfPreamble.index),
            R.split(/\s*\n\s+/),
            R.map(R.pipe(R.split(/\s*=\s*/), R.map(R.trim))),
            R.fromPairs,
            R.mergeAll
        )(contents)
    }        
}

// String -> {[<key>: String]}
function parseElmMarkup(contents) {
    const preamble = parseElmMarkupPreamble(contents)
    return R.merge(preamble, { content: contents })
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
        let attrs = R.pipe(
            ext == ".md" ? parseMarkdown : parseElmMarkup,
            R.evolve({ title: unquote })
        )(contents)

        if (!R.isNil(attrs.contentSource)) {
            const transcludedContents = readFile(Path.join("_pages", attrs.contentSource + ext))
            const transcludedAttrs = ext == ".md" ? parseMarkdown(transcludedContents) : parseElmMarkup(transcludedContents)
            attrs = R.merge(attrs, R.pick(["content", "excerpt", "markdown"], transcludedAttrs))
        }
        else
            ; // Do nothing - the file doesn't link to another file's content

        return R.pipe(
            R.merge(R.__, attrs),
            R.merge({ siteTitle: appendTitle(siteTitle, attrs.title) }),
            R.merge(parsePageFileName(outputPath, pageFileName))
        )({ layout: "Page", mtime, pageFileName })
    }
    else
        return existingPage
})

// [PageConfig] -> String -> String -> String -> [String] -> [HtmlPage]/Effects
function generatePages(pages, elmJs, outputPath, siteTitle, pageFileNames) {
    return R.pipe(
        R.map(generatePageConfig(pages, outputPath, siteTitle)),
        R.map((page) => R.isNil(page.html) ? R.merge(page, { html: generateHtml(elmJs, page) }) : page)
    )(pageFileNames)
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

// [PostConfig] -> String -> String -> String -> [String] -> Bool -> [String] -> [PostHtmlPage]/Effects
function generatePosts(posts, elmJs, outputPath, siteTitle, allowedTags, includeDrafts, postFileNames) {
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
                    R.evolve({ tags: R.pipe(R.split(/\s+/), R.map(R.trim), R.reject(R.isEmpty)), title: unquote })
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
                    R.merge(R.__, attrs),
                    R.merge({ siteTitle: appendTitle(siteTitle, attrs.title) }),
                    R.evolve({
                        tags: R.pipe(R.append(fileNameAttrs.section), R.reject(R.isEmpty))
                    }),
                    R.merge(fileNameAttrs)
                )({ layout: fileNameAttrs.isIndex ? "Posts" : "Post", mtime, postFileName })
            }
            else
                return existingPost
        })
        , R.filter(draftFilter)
    )(postFileNames)

    return R.pipe(
        R.map((postConfig) => {
            if (postConfig.isIndex) {
                const filter = R.isEmpty(postConfig.section) ?
                    R.identity : R.propEq("section", postConfig.section)
                return R.merge(postConfig,
                    { posts: R.filter(R.both(filter, R.propEq("isIndex", false)), postConfigs) })
            }
            else {
                return postConfig
            }
        }),
        R.map((post) => R.isNil(post.html) ? R.merge(post, { html: generateHtml(elmJs, post) }) : post)
    )(postConfigs)
}

// String -> PageConfig | PostConfig -> HtmlString
function generateHtml(elmJs, pageOrPost) {
    log.info("    Generating " + pageOrPost.outputPath)
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

// String -> HtmlPage | PostHtmlPage -> Promise
function writeHtmlPage(page) {
    const outputPath = R.endsWith("index", page.outputPath) ?
        page.outputPath + ".html" : Path.join(page.outputPath, "index.html")
    return Fs.mkdirs(Path.dirname(outputPath))
        .then(() => {
            return Fs.writeFile(outputPath, page.html)
        })
}

// [PostHtmlPage] -> [String]
const extractTags = R.pipe(
    R.map(R.pipe(R.prop("tags"), R.defaultTo([]))),
    R.flatten,
    R.uniq
)

// String -> [PostHtmlPage] -> [PostHtmlPage]
const getPostsWithTag = (tag, posts) =>
    R.filter(R.pipe(R.prop("tags"), R.defaultTo([]), R.map(R.toLower), R.contains(R.toLower(tag))), posts)

// String -> String -> [PostHtmlPage] -> [TagPage]
function generateTagPages(elmJs, outputPath, siteTitle, posts) {
    return R.pipe(
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
        R.map((page) => R.merge(page, { html: generateHtml(elmJs, page) }))
    )(posts)
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
    generateFeed(outputPath, R.merge(feedConfig, { isSectionFeed: false }), posts)

    R.forEach((section) => {
        generateFeed(
            Path.join(outputPath, section),
            R.evolve({
                title: R.concat(R.__, `/${section}`),
                id: R.concat(R.__, `/${section}`),
                link: R.concat(R.__, `/${section}`)
            }, R.merge(feedConfig, { isSectionFeed: true })),
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

// [PageConfig] -> [PostConfig] -> {includeDrafts: Bool} -> ()/Effects
function generateEverything(pages, posts, options) {
    const config = readConfig()

    log("  Compiling layouts")
    const elmJs = buildLayouts(config.elm)

    log("  Generating pages")
    const newPages = generatePages(pages, elmJs, config.outputDir, config.siteTitle, 
        Glob.sync("**/*.*(md|emu)", { cwd: "_pages" }))

    log("  Generating posts")
    const newPosts = generatePosts(posts, elmJs, config.outputDir, config.siteTitle, 
        config.allowedTags, options.includeDrafts, Glob.sync("_posts/**/*.*(md|emu)"))

    log("  Generating tag pages")
    const tagPages = generateTagPages(elmJs, config.outputDir, config.siteTitle, newPosts)

    const dotGitPath = Path.join(config.outputDir, ".git")
    const dotGitContent = Fs.pathExistsSync(dotGitPath) ?
        Fs.readFileSync(Path.join(config.outputDir, ".git")).toString() : null

    if (options.keepOutputAlive) {
        ; // do nothing
    } else {
        log(`  Cleaning out the output path (${config.outputDir})`)
        Fs.emptyDirSync(config.outputDir)
    }


    if (R.is(String, dotGitContent))
        Fs.writeFileSync(dotGitPath, dotGitContent)
    else
        ; // Do nothing, no .git file existed

    log("  Writing HTML")
    
    Promise.all(
        [].concat(R.map(writeHtmlPage, newPages), R.map(writeHtmlPage, newPosts), R.map(writeHtmlPage, tagPages))
    )
    .then(promiseFileWritings => {
        log("  Duplicating pages")
        duplicatePages(config.copy, config.outputDir)
        log("  Generating feeds")
        generateFeeds(config.feed, config.outputDir, R.reject(R.propEq("isIndex", true), newPosts))

        if (config.postProcess && config.postProcess.length && config.postProcess.length > 0) {
            log("  Doing your postprocessing")
            config.postProcess.forEach(command => {
                log(`      ${command}`)
                spawn.sync(command, {shell: true})
            })
        }
        
        log("  Copying resources")
        copyResources(config.outputDir)
        log("  Done.")

        return promiseFileWritings
    })
    .catch((e) => {
        throw e
        process.exit(1)
    })

    return { pages: newPages, posts: newPosts }
}

// {includeDrafts: Bool} -> {pages: [HtmlPage], posts: [HtmlPage]}/Effects
function buildSite(options) {
    log("Building the site" + (options.includeDrafts ? ", including draft content" : ""))
    return generateEverything([], [], options)
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

// {includeDrafts: Bool} -> ()/Effects
function buildSiteAndWatch(options) {
    const result = buildSite(options)
    let pages = result.pages
    let posts = result.posts

    log("Ready! Watching for changes...")

    const watchPaths = ["_layouts", "_pages", "_posts", "_resources", "config.json", "elm.json"]
    let watcher = Chokidar.watch(watchPaths, { ignoreInitial: true, followSymlinks: false })

    watcher.on("all", debounceFileEvents(100, (events) => {
        try {  // The try block is needed to prevent Node printing a stack trace on exception
            R.forEach((e) => { log.info(`${e.path} ${humaniseFsEvent(e.event)}`) }, events)

            const layoutsChanged = R.any(R.pipe(R.prop("path"), R.startsWith("_layouts")), events)
            const result = generateEverything(layoutsChanged ? [] : pages, layoutsChanged ? [] : posts, R.merge(options, {keepOutputAlive: true}))
            pages = result.pages
            posts = result.posts
            log("Ready! Watching for more changes...")    
        }
        catch (err) {
            if (!R.isEmpty(err.message)) {
                log.error("\n" + err.message) 
            }
            else
                ; // No message means it's an `elm make` error, so it's already printed
            log("Error! Watching for more changes...")    
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

// LogObject -> ()/Effects
const enableVerboseLogging = R.curry((log, isVerbose) => log.info = console.info)


// ACTION STARTS HERE

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
    .command("init", )
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
    .action((cmd) => buildSite({ includeDrafts: cmd.drafts }))

try {
    if (process.argv.length < 3)
        buildSite({ includeDrafts: false })
    else
        flags.parse(process.argv)  // This invokes command & option callbacks 
}    
catch (err) {
    if (!R.isEmpty(err.message))
        log.error("\n" + err.message)
    else 
        ; // No message means it's an elm make error, so it's already printed
    process.exitCode = 1
}
