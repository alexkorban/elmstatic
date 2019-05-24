#!/usr/bin/env node
const Fs = require("fs-extra")
const {Feed} = require("feed")
const Glob = require("glob")
const JsDom = require("jsdom").JSDOM
const Path = require("path")
const Promise = require("bluebird")
const R = require("ramda")
const {Script} = require("vm")
const removeMarkdown = require("remove-markdown")
const {spawn} = require("cross-spawn")

// String -> ()/Effects
function buildLayouts(elmPath) {
    const layouts = R.reject(R.endsWith("Elmstatic.elm"), Glob.sync("_layouts/**/*.elm"))
    let command = R.isNil(elmPath) ? "elm" : elmPath
    let args = ["make", layouts, "--optimize", "--output", "elm.js"]

    console.log(`  $ ${command} ${R.flatten(args).join(" ")}`)
    const res = spawn.sync(command, R.flatten(args), { stdio: 'inherit' })
    if (res.status != 0)
        throw new Error(res.error)
    else
        return Fs.readFileSync("elm.js").toString()
}

// String -> String
function dropExtension (fileName) {
    return R.slice(0, R.lastIndexOf(".", fileName), fileName)
}

// String -> {contentStartIndex: Int, preamble: String}
function extractPreamble(contents) {
    const preambleMarker = "---\n"
    if (!R.startsWith(preambleMarker, contents))
        return {
            contentStartIndex: 0,
            preamble: ""
        }
    
    const endOfPreamble = contents.indexOf(preambleMarker, R.length(preambleMarker))
    
    if (endOfPreamble == -1)
        return {
            contentStartIndex: 0,
            preamble: ""
        }
    else {
        const preamble = R.slice(R.length(preambleMarker), endOfPreamble, contents)
        return {
            contentStartIndex: endOfPreamble + R.length(preambleMarker),
            preamble: preamble
        }
    }
}

// String -> [String, String]
function parsePreambleLine(line) {
    return R.pipe(
          R.splitAt(R.indexOf(":", line))
        , R.evolve({1: R.tail})
        , R.map(R.trim)
    )(line)
}

// String -> String
function unquote(s) {
    const startIndex = R.startsWith("\"", s) ? 1 : 0
    const endIndex = R.endsWith("\"", s) ? R.length(s) - 1 : R.length(s)
    return R.slice(startIndex, endIndex, s)
}

const appendTitle = R.curry((title, s) => R.isNil(title) || R.isEmpty(title) ? s : s + " | " + title)

// String -> Object<String>
const parsePreamble = R.pipe(
    R.split("\n")
  , R.reject(R.isEmpty)
  , R.map(parsePreambleLine)
  , R.fromPairs
  , R.evolve({tags: R.pipe(R.split(/\s+/), R.map(R.trim), R.reject(R.isEmpty)), title: unquote})
)

// String -> Object<String>
function parseMarkdown(contents) {
    const {contentStartIndex, preamble} = extractPreamble(contents)
    const contentsWithoutPreamble = R.drop(contentStartIndex, contents)
    const excerpt = R.pipe(removeMarkdown, R.slice(0, 500), R.concat(R.__, "..."))(contentsWithoutPreamble)
    return R.merge(parsePreamble(preamble), {excerpt, markdown: contentsWithoutPreamble})
}

// String -> String -> Object<String>
function parsePageFileName(outputPath, pageFileName) {
    return {outputPath: Path.join(outputPath, dropExtension(pageFileName))}
}

// String -> String/Effects
function readFile(unresolvedFileName) {
    const resolvedFileName = Fs.lstatSync(unresolvedFileName).isSymbolicLink() ?
        Fs.realpathSync(Fs.readlinkSync(unresolvedFileName))
        : unresolvedFileName

    return Fs.readFileSync(resolvedFileName).toString()
}

// String -> String -> [String] -> [HtmlPageConfig]/Effects
function generatePageConfigs(outputPath, siteTitle, pageFileNames) {
    return R.map((pageFileName) => {
        const contents = readFile(Path.join("_pages", pageFileName))
        let mdAttrs = parseMarkdown(contents)

        if (!R.isNil(mdAttrs.content)) {
            const transcludedContents = readFile(Path.join("_pages", mdAttrs.content + ".md"))
            const transcludedMdAttrs = parseMarkdown(transcludedContents)
            mdAttrs = R.merge(mdAttrs, R.pick(["excerpt", "markdown"], transcludedMdAttrs))
        }
        else 
            ; // Do nothing - the file doesn't link to another file's content

        return R.pipe(
              R.merge(R.__, mdAttrs)             
            , R.merge({siteTitle: appendTitle(siteTitle, mdAttrs.title)})
            , R.merge(parsePageFileName(outputPath, pageFileName))
        )({layout: "Page"})
    }, pageFileNames)
}

// String -> String -> Object<String>
function parsePostFileName(outputPath, postFileName) {
    const dirName = Path.dirname(postFileName)
    const section = R.equals(dirName, "posts") ? "" 
        : R.slice(R.lastIndexOf(Path.sep, dirName) + 1, R.length(dirName), dirName)

    if (R.endsWith("index.md", postFileName)) {
        return {
            isIndex: true, section, outputPath: Path.join(outputPath, dirName)
        }
    } 
    else {
        const date = R.take(10, Path.basename(postFileName))
        const slug = R.pipe(Path.basename, R.drop(11), dropExtension)(postFileName)
        const link = Path.join(dirName, date + "-" + slug)

        return {
            isIndex: false, date, slug, link, section, outputPath: Path.join(outputPath, link)
        }
    }
}

// String -> String -> [String] -> Bool -> [String] -> [PostConfig]/Effects
function generatePostConfigs(outputPath, siteTitle, allowedTags, includeDrafts, postFileNames) {
    const draftFilter = includeDrafts ? R.identity : 
        (postConfig) => postConfig.isIndex || new Date(postConfig.date) <= new Date()

    const postConfigs = R.pipe(
          R.map((postFileName) => {
            const outputFileName = R.tail(postFileName)  // Remove leading underscore 
            const contents = Fs.readFileSync(Fs.realpathSync(postFileName)).toString()
            const mdAttrs = parseMarkdown(contents)
            const fileNameAttrs = parsePostFileName(outputPath, outputFileName)
            const isIndex = R.endsWith("index.md", outputFileName)

            if (!R.isEmpty(allowedTags) && !R.isNil(mdAttrs.tags)) {
                const invalidTags = R.difference(R.map(R.toLower, mdAttrs.tags), allowedTags)
                if (!R.isEmpty(invalidTags))
                    throw new Error(`Invalid tags [${invalidTags.join(", ")}] found in ${postFileName}`)
                else 
                    ; // All post tags are valid
            }
            else 
                ; // Don't do tag validation if allowed tags are not defined or the post has no tags

            return R.pipe(
                R.merge(R.__, mdAttrs)
                , R.merge({siteTitle: appendTitle(siteTitle, mdAttrs.title)})
                , R.evolve({
                    tags: R.pipe(R.append(fileNameAttrs.section), R.reject(R.isEmpty))
                })
                , R.merge(fileNameAttrs)
            )({layout: isIndex ? "Posts" : "Post"})
          })           
        , R.filter(draftFilter)
    )(postFileNames)
    
    return R.map((postConfig) => {
        if (postConfig.isIndex) {
            const filter = R.isEmpty(postConfig.section) ? 
                R.identity : R.propEq("section", postConfig.section)
            return R.merge(postConfig, 
                {posts: R.filter(R.both(filter, R.propEq("isIndex", false)), postConfigs)})
        }
        else {
            return postConfig
        }
    }, postConfigs)
}

// String -> PageConfig | PostConfig -> Promise<HtmlString>
function generateHtml(elmJs, pageOrPost) {        
    const script = new Script(`
    ${elmJs}; let app = Elm.${pageOrPost.layout}.init({flags: ${JSON.stringify(pageOrPost)}})
    `)
    const dom = new JsDom(`<!DOCTYPE html><html><body></body></html>`, {
        runScripts: "outside-only"
    })
    
    try {
        dom.runVMScript(script)
        return Promise.delay(1).then(() => ({
            outputPath: pageOrPost.outputPath,
            html: "<!doctype html>" + R.replace(/citatsmle-script/g, "script", dom.window.document.body.innerHTML)
        }))
    }
    catch (err) {
        return Promise.reject(err)
    }
}

// String -> String -> Promise<[()]>/Effects
function generateHtmlPages(elmJs, configs) {
    return Promise.all(R.map((page) => {
        return generateHtml(elmJs, page)
            .then((pageOutput) => { 
                const outputPath = R.endsWith("index", pageOutput.outputPath) ? 
                    pageOutput.outputPath + ".html" : Path.join(pageOutput.outputPath, "index.html")
                Fs.mkdirsSync(Path.dirname(outputPath))
                Fs.writeFileSync(outputPath, pageOutput.html) 
            })
            .catch((error) => {
                console.error("Encountered a problem: ", error)
            })    
    }, configs))
}

// [Post] -> [String]
const extractTags = R.pipe(
    R.map(R.pipe(R.prop("tags"), R.defaultTo([])))   
  , R.flatten
  , R.uniq
)

// String -> [PostConfig] -> [PostConfig]
const getPostsWithTag = (tag, posts) => 
    R.filter(R.pipe(R.prop("tags"), R.defaultTo([]), R.map(R.toLower), R.contains(R.toLower(tag))), posts)

// String -> String -> [PostConfig] -> [TagPageConfig]
function generateTagPageConfigs(outputPath, siteTitle, postConfigs) {
    return R.map((tag) => ({
        layout: "Tag",
        markdown: "",
        outputPath: Path.join(outputPath, "tags", tag), 
        posts: getPostsWithTag(tag, postConfigs),
        section: "",
        siteTitle: appendTitle(siteTitle, "Tag: " + tag),
        tag,
        title: "Tag: " + tag
    }), extractTags(postConfigs))
}

// [PostConfig] -> [String]
const extractSections = R.pipe(
    R.map(R.prop("section"))
  , R.reject(R.isEmpty)
  , R.uniq
)

// Path -> FeedConfig -> [Post] -> ()/Effects
function generateFeed(outputPath, config, posts) {
    let feed = new Feed(config)
    
    R.forEach((post) => {
        const section = R.isEmpty(post.section) || config.isSectionFeed ? "" : post.section + "/"
        const id = config.link + "/" + section + post.date + "-" + post.slug
        feed.addItem({
              title: post.title
            , id: id
            , link: id
            , description: post.description || post.excerpt
            , author: [config.author]
            , date: new Date(post.date)
        })        
    }, posts)
    
    Fs.writeFileSync(outputPath, feed.rss2())
}

// String -> [PostConfig] -> ()/Effects
function generateFeeds(feedConfig, outputPath, postConfigs) {
    console.log("Generating feeds...")
    console.log(`  Writing ${Path.join(outputPath, "rss.xml")}`)
    const sections = extractSections(postConfigs)
    generateFeed(Path.join(outputPath, "rss.xml")
        , R.merge(feedConfig, {isSectionFeed: false}), postConfigs)   

    R.forEach((section) => {
        console.log(`  Writing ${Path.join(outputPath, section, "rss.xml")}`)
        generateFeed(Path.join(outputPath, section, "rss.xml")
            , R.evolve({
                      title: R.concat(R.__, `/${section}`)
                    , id: R.concat(R.__, `/${section}`)
                    , link: R.concat(R.__, `/${section}`)
                }, R.merge(feedConfig, {isSectionFeed: true}))
            , getPostsWithTag(section, postConfigs))    
    }, sections)
}

// DuplicateConfig -> String -> ()/Effects
function duplicatePages(config, outputPath) {
    console.log("Duplicating pages...")
    R.forEachObjIndexed((dest, source) => {
        Fs.copySync(Path.join(outputPath, source), Path.join(outputPath, dest))
    }, config)
}

// () -> ()/Effects
function generateScaffold() {
    console.log("Generating scaffold...")
    Fs.copySync(Path.join(__dirname, "..", "scaffold"), process.cwd())
}

// () -> ()/Effects
function printHelp() {
    const {version} = JSON.parse(Fs.readFileSync(Path.join(__dirname, "..", "package.json")).toString()) 
    R.forEach(console.log, 
        [ "Elmstatic v" + version + "\n"
        , "Usage:\n"
        , "Elmstatic has to be run from the site directory\n"
        , "$ elmstatic       -> generate HTML for an existing site in the specified output directory"
        , "$ elmstatic draft -> same as above, but including future-dated draft posts"
        , "$ elmstatic init  -> generate a scaffold for a new site in the current directory\n"
        , "See https://korban.net/elm/elmstatic for more information"
        ])
}

// ACTION STARTS HERE

let mode = "help"
if (process.argv.length < 3)
    mode = "generate"
else if (process.argv[2] == "init")
    mode = "init"
else if (process.argv[2] == "draft")
    mode = "draft"

if (mode == "generate" || mode == "draft") {
    try {
        Fs.accessSync("config.json", Fs.constants.R_OK)
    } 
    catch (err) {
        console.error("Couldn't find config.json. Is this a new project? Run `elmstatic init` to generate a scaffold.")
        return
    }

    const config = JSON.parse(Fs.readFileSync("config.json").toString())
    const {copy, feed, elm, outputDir, siteTitle} = config
    const allowedTags = R.map(R.toLower, R.defaultTo([], config.tags))
    const includeDrafts = (mode == "draft")

    try {            
        console.log(`Compiling layouts...`)
        const elmJs = buildLayouts(elm)

        console.log(`Reading .md files...`)
        const pageConfigs = generatePageConfigs(outputDir, siteTitle, Glob.sync("**/*.md", {cwd: "_pages"}))
        const postConfigs = generatePostConfigs(outputDir, siteTitle, allowedTags, includeDrafts, Glob.sync("_posts/**/*.md"))
        const tagPageConfigs = generateTagPageConfigs(outputDir, siteTitle, postConfigs)

        const dotGitPath = Path.join(outputDir, ".git")
        const dotGitContent = Fs.pathExistsSync(dotGitPath) ? 
            Fs.readFileSync(Path.join(outputDir, ".git")).toString() : null

        console.log(`Cleaning out the output path (${outputDir})...`)
        Fs.emptyDirSync(outputDir)

        if (R.is(String, dotGitContent))
            Fs.writeFileSync(dotGitPath, dotGitContent)
        else 
            ; // Do nothing, no .git file existed

        console.log("Generating HTML...")
        generateHtmlPages(elmJs, pageConfigs)
        .then(() => generateHtmlPages(elmJs, postConfigs))
        .then(() => generateHtmlPages(elmJs, tagPageConfigs))
        .then(() => generateFeeds(feed, outputDir, postConfigs))
        .then(() => duplicatePages(copy, outputDir))
        .then(() => {
            console.log("Copying resources...")
            if (Fs.pathExistsSync("_resources"))
                Fs.copySync("_resources", outputDir)    
            else
                ; // Do nothing - resources dir not present
        })
        .then(() => console.log("Done!"))
    } catch (err) {
        console.log(err.message)
    }
} 
else if (mode == "init") {
    generateScaffold()
}
else {
    printHelp()
}

