module Page exposing (header, markdown, tagsToHtml, title, topLevelHeader, view, Header, PageStyles(..), Variations(..))

import Color exposing (..)
import Color.Convert exposing (..)
import Element exposing (..)
import Element.Attributes exposing (..)
import Html
import Html.Attributes exposing (attribute)
import Markdown exposing (..)
import String exposing (toLower)
import Style exposing (..)
import Style.Border as Border
import Style.Color as Color
import Style.Font as Font
import Style.Shadow as Shadow
import Style.Transition as Transition
import Tags exposing (..)


type PageStyles
    = None
    | Box
    | Divider
    | FooterItem
    | FooterPanel
    | HeaderPanel
    | Heading
    | Label
    | Link
    | Logo
    | Main
    | Markdown
    | NavOption
    | PostDate
    | PostFooter
    | PostFooterRight
    | SmallHeading
    | Tag
    | TextField
    | Title


baseTypeface =
    Font.typeface [ Font.font "Open Sans", Font.font "Arial", Font.sansSerif ]


headingTypeface =
    Font.typeface [ Font.font "Proza Libre", Font.font "Helvetica", Font.sansSerif ]



----------------------------------------------------------------------------------


headerStyles =
    [ style HeaderPanel
        [ Border.bottom 2
        , Border.solid
        , Color.background <| Result.withDefault Color.white (Color.Convert.hexToColor "f2fae8")
        , Color.border <| Result.withDefault Color.black (Color.Convert.hexToColor "3c8765")
        ]
    , style Logo
        [ Font.size 25
        , baseTypeface
        ]
    , style NavOption
        [ Font.size 16
        , headingTypeface
        ]
    ]


type alias HeaderDetails =
    { title : { url : String, name : String }
    , links : List { url : String, name : String }
    }


type alias Header v m =
    Element PageStyles v m


header : HeaderDetails -> Header v m
header { title, links } =
    row HeaderPanel
        [ spread, paddingXY 60 20, width (percent 100) ]
        [ row None
            [ spacing 5 ]
            [ link title.url <| el None [] <| image None [ width (px 75), height (px 65) ] { src = "/img/logo.png", caption = "Author's blog" }
            , el Logo [ verticalCenter ] (link title.url (text title.name))
            ]
        , row None [ spacing 20 ] <|
            List.map (\namedUrl -> el NavOption [ verticalCenter ] (link namedUrl.url <| text namedUrl.name)) links
        ]



----------------------------------------------------------------------------------


footerStyles =
    [ style FooterPanel
        [ Border.top 2
        , Border.solid
        , Color.background <| Result.withDefault Color.black (Color.Convert.hexToColor "348aa7")
        , Color.border <| Result.withDefault Color.black (Color.Convert.hexToColor "2f4858")
        , Color.text <| Color.white
        ]
    , style Logo
        [ Font.size 25
        , baseTypeface
        ]
    , style FooterItem
        [ Font.size 16
        , headingTypeface
        , Color.text <| Color.white
        ]
    ]


githubIcon =
    let
        pathNode =
            Html.node "path"
                [ Html.Attributes.attribute "fill" "#fff"
                , Html.Attributes.attribute "d" """
M7.999,0.431c-4.285,0-7.76,3.474-7.76,7.761 c0,3.428,2.223,6.337,5.307,7.363c0.388,0.071,0.53-0.168,0.53-0.374c0-0.184-0.007-0.672-0.01-1.32 c-2.159,0.469-2.614-1.04-2.614-1.04c-0.353-0.896-0.862-1.135-0.862-1.135c-0.705-0.481,0.053-0.472,0.053-0.472 c0.779,0.055,1.189,0.8,1.189,0.8c0.692,1.186,1.816,0.843,2.258,0.645c0.071-0.502,0.271-0.843,0.493-1.037 C4.86,11.425,3.049,10.76,3.049,7.786c0-0.847,0.302-1.54,0.799-2.082C3.768,5.507,3.501,4.718,3.924,3.65 c0,0,0.652-0.209,2.134,0.796C6.677,4.273,7.34,4.187,8,4.184c0.659,0.003,1.323,0.089,1.943,0.261 c1.482-1.004,2.132-0.796,2.132-0.796c0.423,1.068,0.157,1.857,0.077,2.054c0.497,0.542,0.798,1.235,0.798,2.082 c0,2.981-1.814,3.637-3.543,3.829c0.279,0.24,0.527,0.713,0.527,1.437c0,1.037-0.01,1.874-0.01,2.129 c0,0.208,0.14,0.449,0.534,0.373c3.081-1.028,5.302-3.935,5.302-7.362C15.76,3.906,12.285,0.431,7.999,0.431z
            """
                ]
                []
    in
        Html.node "svg" [ Html.Attributes.attribute "viewBox" "0 0 16 16" ] [ pathNode ]


twitterIcon =
    let
        pathNode =
            Html.node "path"
                [ Html.Attributes.attribute "fill" "#fff"
                , Html.Attributes.attribute "d" """
M15.969,3.058c-0.586,0.26-1.217,0.436-1.878,0.515c0.675-0.405,1.194-1.045,1.438-1.809 c-0.632,0.375-1.332,0.647-2.076,0.793c-0.596-0.636-1.446-1.033-2.387-1.033c-1.806,0-3.27,1.464-3.27,3.27 c0,0.256,0.029,0.506,0.085,0.745C5.163,5.404,2.753,4.102,1.14,2.124C0.859,2.607,0.698,3.168,0.698,3.767 c0,1.134,0.577,2.135,1.455,2.722C1.616,6.472,1.112,6.325,0.671,6.08c0,0.014,0,0.027,0,0.041c0,1.584,1.127,2.906,2.623,3.206 C3.02,9.402,2.731,9.442,2.433,9.442c-0.211,0-0.416-0.021-0.615-0.059c0.416,1.299,1.624,2.245,3.055,2.271 c-1.119,0.877-2.529,1.4-4.061,1.4c-0.264,0-0.524-0.015-0.78-0.046c1.447,0.928,3.166,1.469,5.013,1.469 c6.015,0,9.304-4.983,9.304-9.304c0-0.142-0.003-0.283-0.009-0.423C14.976,4.29,15.531,3.714,15.969,3.058z
            """
                ]
                []
    in
        Html.node "svg" [ Html.Attributes.attribute "viewBox" "0 0 16 16" ] [ pathNode ]


footer =
    row FooterPanel
        [ spread, paddingXY 60 20, width (percent 100) ]
        [ row None
            [ spacing 5 ]
            [ link "/" <| el None [] <| image None [ width (px 75), height (px 65) ] { src = "/img/logo.png", caption = "Author's blog" }
            , el Logo [ verticalCenter ] (link "/" (text "Author's blog"))
            ]
        , row None
            [ spacing 20 ]
            [ row None
                [ spacing 5 ]
                [ el FooterItem [ verticalCenter, width <| px 16, height <| px 16 ] (Element.html twitterIcon)
                , el FooterItem [ verticalCenter ] <| newTab "https://twitter.com" <| text "Author's Twitter"
                ]
            , row None
                [ spacing 5 ]
                [ el FooterItem [ verticalCenter, width <| px 16, height <| px 16 ] (Element.html githubIcon)
                , el FooterItem [ verticalCenter ] <| newTab "https://github.com" <| text "Author's Github"
                ]
            , row None
                [ spacing 5 ]
                [ el FooterItem [ verticalCenter ] <|
                    newTab "https://www.npmjs.com/package/elmstatic" <|
                        text "&nbsp;&nbsp;&nbsp;|&gt;&nbsp;Created&nbsp;with&nbsp;Elmstatic"
                ]
            ]
        ]



----------------------------------------------------------------------------------


linkColor =
    Result.withDefault Color.blue (Color.Convert.hexToColor "348aa7")


type Variations
    = Linked


linkedVariation =
    variation Linked [ Color.text linkColor ]


mainContentStyles =
    [ style Title
        [ Font.size 44
        , headingTypeface
        ]
    , style Heading
        [ Font.size 32
        , headingTypeface
        , linkedVariation
        ]
    , style Link
        [ Color.text linkColor
        ]
    , style SmallHeading
        [ Font.size 24
        , headingTypeface
        , linkedVariation
        ]
    ]



----------------------------------------------------------------------------------


otherStyles =
    [ style None [] -- It's handy to have a blank style
    , style Label
        [ Font.size 25
        , Font.center
        ]
    , style Main
        [ Border.all 0
        , Color.text Color.darkCharcoal
        , Color.border Color.lightGrey
        , baseTypeface
        , Font.size 18
        , Font.lineHeight 1.5
        ]
    , style Box
        [ Transition.all
        , Color.text Color.white
        , Color.background Color.blue
        , Color.border Color.blue
        , Border.rounded 3
        , hover
            [ Color.text Color.white
            , Color.background Color.red
            , Color.border Color.red
            , cursor "pointer"
            ]
        ]
    , style Divider
        [ Color.background Color.lightGrey
        ]
    , style PostDate
        [ Color.text Color.darkGrey
        , Font.size 16
        , Font.lineHeight 1
        ]
    , style PostFooter
        [ Border.top 2
        , Border.bottom 2
        , Color.background <| Result.withDefault Color.white (Color.Convert.hexToColor "f2fae8")
        , Color.border <| Color.lightGrey
        ]
    , style PostFooterRight
        [ Border.left 1
        , Color.border <| Color.lightGrey
        ]
    , style Tag
        [ Border.rounded 3
        , Border.all 1
        , Color.border Color.lightGrey
        , Color.background <| Result.withDefault Color.white (Color.Convert.hexToColor "f2fae8")
        , Color.text linkColor
        , headingTypeface
        , Font.size 14
        , Font.lineHeight 1
        ]
    , style TextField
        [ Border.all 1
        , Border.rounded 3
        , Color.border <| Result.withDefault Color.grey (Color.Convert.hexToColor "2f4858")
        ]
    ]


styleSheet : StyleSheet PageStyles Variations
styleSheet =
    Style.styleSheet
        (headerStyles ++ footerStyles ++ mainContentStyles ++ otherStyles)


topLevelHeader : Header v m
topLevelHeader =
    header
        { title = { url = "/", name = "Author's blog" }
        , links =
            [ { url = "/posts", name = "Posts" }
            , { url = "/about", name = "About" }
            ]
        }


view : Header Variations m -> List (Element PageStyles Variations m) -> Html.Html m
view header contentElems =
    viewport styleSheet <|
        column Main
            [ center, width (percent 100) ]
            [ header
            , column Main
                [ width <| px 800, paddingTop 10, paddingBottom 50, spacingXY 0 10, alignLeft ]
                contentElems
            , footer
            ]


title : String -> Element PageStyles v msg
title t =
    paragraph Title [ paddingBottom 20 ] [ text t ]


markdown : String -> Element PageStyles v msg
markdown content =
    el None [] <|
        Element.html <|
            Html.div [ Html.Attributes.class "markdown" ] (Markdown.toHtml Nothing content)


tagsToHtml : List Tag -> Element PageStyles v msg
tagsToHtml tags =
    let
        tagLink tag =
            "/tags/" ++ (toLower <| toString tag)

        linkify tag =
            link (tagLink tag) (el Tag [ padding 4 ] (text <| toString tag))

        tagElems =
            List.map linkify tags
    in
        row None [ spacingXY 10 10, verticalCenter ] tagElems
