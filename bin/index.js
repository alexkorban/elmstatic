#!/usr/bin/env node
const elmStaticHtml = require("elm-static-html-lib").multiple
const Feed = require("feed")
const Fs = require("fs-extra")
const Glob = require("glob")
const Path = require("path")
const Promise = require("bluebird")
const R = require("ramda")
const removeMarkdown = require("remove-markdown")

const logPipeState = R.curry((label, pipeState) => {
    console.log(label + ":", pipeState)
    return pipeState
})

// String -> String
function dropExtension (fileName) {
    return R.slice(0, R.lastIndexOf(".", fileName), fileName)
}

// [String] -> [String]
const dropExtensions = R.map(dropExtension)

// String -> String
const slashesToDots = R.replace(new RegExp(Path.sep, "g"), ".")
// [String] -> String
const replaceSlashesWithDots = R.map(slashesToDots)

// String -> String
const getPageDirName = R.pipe(R.replace("Pages.", ""), R.replace(/\./g, Path.sep), R.toLower)

// String -> Object -> String
function fullPageHtml(templateHtml, params) {
    return templateHtml.replace(/\${([^}]*)}/g, (r, k) => params[k])
} 

// String -> [String] -> [HtmlPageConfig]
function generatePageConfigs(outputPath, pageFileNames) {
    return R.map((pageFileName) => {
        const moduleName = slashesToDots(pageFileName)
        const dir = Path.join(outputPath, getPageDirName(pageFileName))
        return {viewFunction: `${moduleName}.view`, model: {}, decoder: `${moduleName}.decode`
            , fileOutputName: dir, newLines: false, indent: 0}
    }, pageFileNames)
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

// String -> Object<String>
const parsePreamble = R.pipe(
      R.split("\n")
    , R.reject(R.isEmpty)
    , R.map(parsePreambleLine)
    , R.fromPairs
    , R.evolve({tags: R.split(/\s+/), title: unquote})
)

// String -> [String] -> [HtmlPageConfig]
function generatePostConfigs(outputPath, postFileNames) {
    return R.map((postFileName) => {
        const contents = Fs.readFileSync(postFileName).toString()
        const date = R.take(10, Path.basename(postFileName))
        const slug = R.pipe(Path.basename, R.drop(11), dropExtension)(postFileName)
        const link = Path.join(Path.dirname(R.toLower(postFileName)), date + "-" + slug)
        const dirName = Path.dirname(postFileName)
        const section = R.equals(dirName, "Posts") ? "" 
            : R.slice(R.lastIndexOf(Path.sep, dirName) + 1, R.length(dirName), dirName)
        const {contentStartIndex, preamble} = extractPreamble(contents)
        const contentsWithoutPreamble = R.drop(contentStartIndex, contents)
        const excerpt = R.pipe(removeMarkdown, R.slice(0, 500), R.concat(R.__, "..."))(contentsWithoutPreamble)
        
        const postMetadata = R.pipe(
              parsePreamble
            , R.merge({date, slug, link, preamble, section, excerpt})
            , R.evolve({tags: R.pipe(R.append(R.toLower(section)), R.reject(R.isEmpty))})
        )(preamble)
        
        const post = R.merge(postMetadata, {preamble, content: contentsWithoutPreamble})

        const moduleName = `Pages.${R.isEmpty(section) ? "" : section + "."}Post`

        const dir = Path.join(outputPath, link)

        return {viewFunction: `${moduleName}.view`, model: post, decoder: `${moduleName}.decode`
            , fileOutputName: dir, newLines: false, indent: 0}
    }, postFileNames)
}

// String -> [Post] -> HtmlPageConfig
function generatePostListPageConfig(outputPath, posts) {
    return {viewFunction: "Pages.Posts.view"
        , model: {tag: "", isSectionList: false, posts: posts}
        , decoder: `Pages.Posts.decode`, fileOutputName: Path.join(outputPath, "posts")
        , newLines: false, indent: 0}
}


// String -> [Post] -> [Post]
const getPostsWithTag = (tag, posts) => 
    R.filter(R.pipe(R.prop("tags"), R.map(R.toLower), R.contains(R.toLower(tag))), posts)

// [Post] -> [String]
const extractTags = R.pipe(
      R.map(R.prop("tags"))
    , R.flatten
    , R.map(R.toLower)
    , R.uniq
)


// String -> [String] -> [Post] -> [HtmlPageConfig]
function generateTagPageConfigs(outputPath, tags, posts) {    
    return R.map((tag) => {
        return {viewFunction: "Pages.Posts.view"
            , model: {tag, isSectionList: false, posts: getPostsWithTag(tag, posts)}
            , decoder: "Pages.Posts.decode", fileOutputName: Path.join(outputPath, "tags", tag)
            , newLines: false, indent: 0}
    }, tags)
}

// [Post] -> [String]
const extractSections = R.pipe(
      R.map(R.prop("section"))
    , R.reject(R.isEmpty)
    , R.uniq
)

// String -> [String] -> [Post] -> [HtmlPageConfig]
function generateSectionPageConfigs(outputPath, sections, posts) {
    return R.map((section) => {
        return {viewFunction: `Pages.${section}.Posts.view`
            , model: {tag: section, isSectionList: true, posts: getPostsWithTag(section, posts)}
            , decoder: `Pages.${section}.Posts.decode`
            , fileOutputName: Path.join(outputPath, "posts", R.toLower(section))
            , newLines: false, indent: 0}
    }, sections)
}

// Path -> FeedConfig -> [Post] -> ()/Effects
function generateFeed(outputPath, config, posts) {
    let feed = new Feed(config)
    
    R.forEach((post) => {
        const section = R.isEmpty(post.section) || config.isSectionFeed ? "" : R.toLower(post.section) + "/"
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
    
    Fs.writeFileSync(outputPath, feed.rss2())
}

// String -> Promise/Effects
function generateCss(outputDir) {
    console.log("Generating global styles...")
    return elmStaticHtml(process.cwd(), [{viewFunction: `Styles.styles`, fileOutputName: Path.join(outputDir, "css")}])
    .then ((genStyles) => {
        const genStyle = genStyles[0]
        console.log(`  Writing ${Path.join(genStyle.fileOutputName, "default.css")}`)
        Fs.mkdirsSync(genStyle.fileOutputName)
        Fs.writeFileSync(Path.join(genStyle.fileOutputName, "default.css"), genStyle.generatedHtml)
    })
}

// String -> String -> Promise/Effects
function generateHtml(config) {
    const {outputDir, siteTitle} = config
    const templateHtml = Fs.readFileSync("template.html").toString()

    const allPages = R.pipe(
        dropExtensions
        , replaceSlashesWithDots
    )(Glob.sync("Pages/**/*.elm"))

    console.log("All pages", allPages)
    console.log("Configuring HTML output...")

    const pageConfigs = generatePageConfigs(outputDir, R.reject(R.test(/(Index|Post(s?))$/), allPages))
    const postConfigs = generatePostConfigs(outputDir, Glob.sync("Posts/**/*.md"))
    const posts = R.map(R.prop("model"), postConfigs)
    const postListPageConfig = generatePostListPageConfig(outputDir, posts)
    const tagPageConfigs = generateTagPageConfigs(outputDir, extractTags(posts), posts)
    const sections = extractSections(posts)
    const sectionPageConfigs = generateSectionPageConfigs(outputDir, sections, posts)

    const allConfigs = R.flatten([pageConfigs, postConfigs, postListPageConfig, tagPageConfigs, sectionPageConfigs])

    console.log("Generating HTML...")
    console.log("  HTML file count:", allConfigs.length)

    return elmStaticHtml(process.cwd(), allConfigs)
    .then((genHtmls) => {
        console.log("Writing HTML to files...")
        R.forEach((genHtml) => {
            console.log(`  Writing ${Path.join(genHtml.fileOutputName, "index.html")}`)
            Fs.mkdirsSync(genHtml.fileOutputName)
            Fs.writeFileSync(Path.join(genHtml.fileOutputName, "index.html")
                , fullPageHtml(templateHtml, {title: siteTitle, content: genHtml.generatedHtml}))
        }, genHtmls)

        console.log("Generating RSS feeds...")

        console.log(`  Writing ${Path.join(outputDir, "rss.xml")}`)
        generateFeed(Path.join(outputDir, "rss.xml"), R.merge(config.feed, {isSectionFeed: false}), posts)

        R.forEach((section) => {
            console.log(`  Writing ${Path.join(outputDir, R.toLower(section), "rss.xml")}`)
            generateFeed(Path.join(outputDir, R.toLower(section), "rss.xml")
                , R.evolve({
                        title: R.concat(R.__, `/${R.toLower(section)}`)
                        , id: R.concat(R.__, `/${R.toLower(section)}`)
                        , link: R.concat(R.__, `/${R.toLower(section)}`)
                    }, R.merge(config.feed, {isSectionFeed: true}))
                , getPostsWithTag(section, posts))    
        }, sections)

        console.log("Generating index page...")
        Fs.copySync(Path.join(outputDir, config.index, "index.html"), Path.join(outputDir, "index.html"))

        console.log("Copying resources...")
        Fs.copySync("Resources", outputDir)

        console.log("Done!")    
    })    
}


// () -> ()/Effects
function generateScaffold() {
    console.log("Generating scaffold...")
    Fs.copySync(Path.join(__dirname, "..", "scaffold"), process.cwd())
}


// () -> ()/Effects
function printHelp() {
    R.forEach(console.log, [ "Usage\n:"
        , "Elmstatic has to be run from the blog directory\n"
        , "$ elmstatic       -> generate HTML for an existing blog in the specified output directory"
        , "$ elmstatic init  -> generate a scaffold for a new blog in the current directory"
    ])
}

// ACTION STARTS HERE

if (process.argv.length < 3) {
    const config = JSON.parse(Fs.readFileSync("config.json").toString())
    const {outputDir, siteTitle} = config

    const dotGitPath = Path.join(outputDir, ".git")
    const dotGitContent = Fs.pathExistsSync(dotGitPath) ? Fs.readFileSync(Path.join(outputDir, ".git")).toString() : null

    console.log(`Cleaning out the output path (${outputDir})...`)
    Fs.emptyDirSync(outputDir)

    if (R.is(String, dotGitContent))
        Fs.writeFileSync(dotGitPath, dotGitContent)
    else 
        ; // Do nothing, no .git file existed
    
    generateCss(outputDir)
    .then(() => generateHtml(config))
    .catch((error) => {
        console.error("Encountered a problem: ", error)
    })
}
else if (process.argv[2] == "init") {
    generateScaffold()
}
else {
    printHelp()
}

