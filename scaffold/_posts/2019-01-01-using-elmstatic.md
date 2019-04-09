---
title: "I'm using Elmstatic for my blog"
tags: software other
---

## Elmstatic is a static blog generator

It allows you to write pages in Elm, and blog posts in Markdown. 

### This is an example of a post

Code is highlighted using [Highlight.js](http://highlightjs.org): 

```
view : Header v m -> List (Element PageStyles v m) -> Html.Html m
view header contentElems =
    viewport stylesheet <|
        column Main
            [ center, width (percent 100) ]
            [ header
            , column Main
                [ width <| px 800, spacingXY 0 10, alignLeft ]
                contentElems
            , footer
            ]
```

### Tags 

The default set of tags can be changed as needed in `config.json`. 
