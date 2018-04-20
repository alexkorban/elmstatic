module Pages.Posts exposing (..)

import Element exposing (..)
import Element.Attributes exposing (..)
import Html
import Json.Decode
import Markdown exposing (..)
import Page exposing (..)
import Tags exposing (..)


type alias PostMetadata =
    { title : String, date : String, link : String, tags : List String }


type alias PageData =
    { tag : String, isSectionList : Bool, postMetadataList : List PostMetadata }


decodeOne =
    Json.Decode.map4 PostMetadata
        (Json.Decode.field "title" Json.Decode.string)
        (Json.Decode.field "date" Json.Decode.string)
        (Json.Decode.field "link" Json.Decode.string)
        (Json.Decode.field "tags" (Json.Decode.list Json.Decode.string))


decode =
    Json.Decode.map3 PageData
        (Json.Decode.field "tag" Json.Decode.string)
        (Json.Decode.field "isSectionList" Json.Decode.bool)
        (Json.Decode.field "posts" (Json.Decode.list decodeOne))


postItem : PostMetadata -> Element PageStyles Variations m
postItem postMetadata =
    let
        postElems =
            [ text postMetadata.date
            , text "•"
            , tagsToHtml <| List.map Tags.fromString postMetadata.tags
            ]
    in
        column None
            [ paddingBottom 10 ]
            [ el SmallHeading [ vary Linked True ] (link ("/" ++ postMetadata.link) (text postMetadata.title))
            , row None [ spacingXY 10 10 ] postElems
            ]


view : PageData -> Html.Html msg
view pageData =
    let
        capitalise s =
            (String.toUpper <| String.left 1 s) ++ String.dropLeft 1 s

        itemList =
            (List.map postItem (List.reverse <| List.sortBy (\p -> p.date ++ p.link) pageData.postMetadataList))

        pageTitle =
            if String.isEmpty pageData.tag then
                "All posts"
            else
                (if pageData.isSectionList then
                    (capitalise pageData.tag) ++ " posts"
                 else
                    "Tag: " ++ (toString <| fromString pageData.tag)
                )
    in
        Page.view Page.topLevelHeader <|
            [ Page.title pageTitle ]
                ++ itemList
