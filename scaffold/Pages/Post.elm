module Pages.Post exposing (..)

import Element exposing (..)
import Element.Attributes exposing (..)
import Html
import Html.Attributes exposing (class)
import Json.Decode
import Markdown exposing (..)
import Page exposing (..)
import Tags exposing (..)


type alias PostParts =
    { title : String, date : String, tags : List String, content : String }


decode =
    Json.Decode.map4 PostParts
        (Json.Decode.field "title" Json.Decode.string)
        (Json.Decode.field "date" Json.Decode.string)
        (Json.Decode.field "tags" (Json.Decode.list Json.Decode.string))
        (Json.Decode.field "content" Json.Decode.string)


postFooter =
    paragraph PostFooter
        [ width fill, paddingXY 10 10 ]
        [ text "Questions or comments? I'm "
        , newTab "https://twitter.com/author_name" <| text "@author_name"
        , text " on Twitter"
        ]


view : PostParts -> Html.Html msg
view postParts =
    let
        postElems =
            [ el PostDate [] (text postParts.date)
            , text "•"
            , tagsToHtml <| List.map Tags.fromString postParts.tags
            ]
    in
        Page.view Page.topLevelHeader
            [ Page.title postParts.title
            , row None [ spacingXY 10 10, verticalCenter, paddingBottom 20 ] postElems
            , Page.markdown postParts.content
            , postFooter
            ]
