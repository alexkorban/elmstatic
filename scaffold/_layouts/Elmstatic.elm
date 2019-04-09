module Elmstatic exposing
    ( Content
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
import Json.Decode


type alias Post =
    { date : String
    , link : String
    , markdown : String
    , section : String
    , siteTitle : String
    , tags : List String
    , title : String
    }


type alias Page =
    { markdown : String
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
    Program Json.Decode.Value Json.Decode.Value Never


decodePage : Json.Decode.Decoder Page
decodePage =
    Json.Decode.map3 Page
        (Json.Decode.field "markdown" Json.Decode.string)
        (Json.Decode.field "siteTitle" Json.Decode.string)
        (Json.Decode.field "title" Json.Decode.string)


decodePost : Json.Decode.Decoder Post
decodePost =
    Json.Decode.map7 Post
        (Json.Decode.field "date" Json.Decode.string)
        (Json.Decode.field "link" Json.Decode.string)
        (Json.Decode.field "markdown" Json.Decode.string)
        (Json.Decode.field "section" Json.Decode.string)
        (Json.Decode.field "siteTitle" Json.Decode.string)
        (Json.Decode.field "tags" <| Json.Decode.list Json.Decode.string)
        (Json.Decode.field "title" Json.Decode.string)


decodePostList : Json.Decode.Decoder PostList
decodePostList =
    Json.Decode.map4 PostList
        (Json.Decode.field "posts" <| Json.Decode.list decodePost)
        (Json.Decode.field "section" Json.Decode.string)
        (Json.Decode.field "siteTitle" Json.Decode.string)
        (Json.Decode.field "title" Json.Decode.string)


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


layout : Json.Decode.Decoder (Content content) -> (Content content -> List (Html Never)) -> Layout
layout decoder view =
    Browser.document
        { init = \contentJson -> ( contentJson, Cmd.none )
        , view =
            \contentJson ->
                case Json.Decode.decodeValue decoder contentJson of
                    Err error ->
                        { title = ""
                        , body = [ htmlTemplate "Error" [ Html.text <| Json.Decode.errorToString error ] ]
                        }

                    Ok content ->
                        { title = ""
                        , body = [ htmlTemplate content.siteTitle <| view content ]
                        }
        , update = \msg contentJson -> ( contentJson, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
