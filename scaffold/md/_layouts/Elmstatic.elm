module Elmstatic exposing
    ( Content
    , Format(..)
    , Layout
    , Page
    , Post
    , PostList
    , decodePage
    , decodePost
    , decodePostList
    , htmlTemplate
    , inlineScript
    , layout
    , script
    , stylesheet
    )

import Browser
import Html exposing (..)
import Html.Attributes exposing (..)
import Json.Decode as Json


type Format
    = Markdown
    | ElmMarkup


type alias Post =
    { content : String
    , date : String
    , format : Format
    , link : String
    , section : String
    , siteTitle : String
    , tags : List String
    , title : String
    }


type alias Page =
    { content : String
    , format : Format
    , siteTitle : String
    , title : String
    }


type alias PostList =
    { posts : List Post
    , section : String
    , siteTitle : String
    , title : String
    }


type alias Content a =
    { a | siteTitle : String, title : String }


type alias Layout =
    Program Json.Value Json.Value Never


{-| For backward compatibility, look for the content either in `markdown` or `content` fields
-}
decodeContent : Json.Decoder String
decodeContent =
    Json.oneOf [ Json.field "markdown" Json.string, Json.field "content" Json.string ]


decodeFormat : Json.Decoder Format
decodeFormat =
    Json.oneOf
        [ Json.map
            (\format ->
                if format == "emu" then
                    ElmMarkup

                else
                    Markdown
            )
          <|
            Json.field "format" Json.string
        , Json.succeed Markdown
        ]


decodePage : Json.Decoder Page
decodePage =
    Json.map4 Page
        decodeContent
        decodeFormat
        (Json.field "siteTitle" Json.string)
        (Json.field "title" Json.string)


decodePost : Json.Decoder Post
decodePost =
    Json.map8 Post
        decodeContent
        (Json.field "date" Json.string)
        decodeFormat
        (Json.field "link" Json.string)
        (Json.field "section" Json.string)
        (Json.field "siteTitle" Json.string)
        (Json.field "tags" <| Json.list Json.string)
        (Json.field "title" Json.string)


decodePostList : Json.Decoder PostList
decodePostList =
    Json.map4 PostList
        (Json.field "posts" <| Json.list decodePost)
        (Json.field "section" Json.string)
        (Json.field "siteTitle" Json.string)
        (Json.field "title" Json.string)


script : String -> Html Never
script src =
    node "citatsmle-script" [ attribute "src" src ] []


inlineScript : String -> Html Never
inlineScript js =
    node "citatsmle-script" [] [ text js ]


stylesheet : String -> Html Never
stylesheet href =
    node "link" [ attribute "href" href, attribute "rel" "stylesheet", attribute "type" "text/css" ] []


htmlTemplate : String -> List (Html Never) -> Html Never
htmlTemplate title contentNodes =
    node "html"
        []
        [ node "head"
            []
            [ node "title" [] [ text title ]
            , node "meta" [ attribute "charset" "utf-8" ] []
            , script "//cdnjs.cloudflare.com/ajax/libs/highlight.js/9.15.1/highlight.min.js"
            , script "//cdnjs.cloudflare.com/ajax/libs/highlight.js/9.15.1/languages/elm.min.js"
            , inlineScript "hljs.initHighlightingOnLoad();"
            , stylesheet "//cdnjs.cloudflare.com/ajax/libs/highlight.js/9.15.1/styles/default.min.css"
            , stylesheet "//fonts.googleapis.com/css?family=Open+Sans|Proza+Libre|Inconsolata"
            ]
        , node "body" [] contentNodes
        ]


layout : Json.Decoder (Content content) -> (Content content -> Result String (List (Html Never))) -> Layout
layout decoder view =
    Browser.document
        { init = \contentJson -> ( contentJson, Cmd.none )
        , view =
            \contentJson ->
                case Json.decodeValue decoder contentJson of
                    Err error ->
                        { title = "error"
                        , body = [ Html.div [ attribute "error" <| Json.errorToString error ] [] ]
                        }

                    Ok content ->
                        case view content of
                            Err viewError ->
                                { title = "error"
                                , body = [ Html.div [ attribute "error" viewError ] [] ]
                                }

                            Ok viewHtml ->
                                { title = ""
                                , body = [ htmlTemplate content.siteTitle <| viewHtml ]
                                }
        , update = \msg contentJson -> ( contentJson, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
