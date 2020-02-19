module ElmMarkup exposing (document, markupToHtml)

import Html exposing (Html)
import Html.Attributes as Attr
import Mark
import Mark.Error


markupToHtml : String -> Result String (List (Html Never))
markupToHtml markup =
    case Mark.compile document markup of
        Mark.Success html ->
            Ok [ html ]

        Mark.Almost { result, errors } ->
            -- This is the case where there has been an error,
            -- but it has been caught by `Mark.onError` and is still rendereable.
            Err <| String.join "\n" <| List.map Mark.Error.toString errors

        Mark.Failure errors ->
            Err <| String.join "\n" <| List.map Mark.Error.toString errors


document =
    Mark.documentWith
        (\metadata body -> Html.article [] body)
        { metadata = metadataBlock
        , body =
            Mark.manyOf
                [ header1
                , header2
                , header3
                , image
                , list
                , code
                , Mark.map (Html.p []) text
                ]
        }



{- Handle Text -}


text =
    Mark.textWith
        { view =
            \styles string ->
                styledText styles string
        , replacements = Mark.commonReplacements
        , inlines =
            [ Mark.annotation "link"
                (\texts url ->
                    Html.a [ Attr.href url ] (List.map (\( styles, str ) -> styledText styles str) texts)
                )
                |> Mark.field "url" Mark.string
            , Mark.verbatim "name"
                (\str ->
                    Html.code [] [ Html.text str ]
                )
            ]
        }


styledText styles string =
    if styles.bold || styles.italic || styles.strike then
        Html.span
            [ Attr.classList
                [ ( "bold", styles.bold )
                , ( "italic", styles.italic )
                , ( "strike", styles.strike )
                ]
            ]
            [ Html.text string ]

    else
        Html.text string


metadataBlock =
    Mark.block "Metadata"
        (\str -> str)
        Mark.string



{- Handle Blocks -}


header1 =
    Mark.block "H1"
        (\children ->
            Html.h1 []
                children
        )
        text


header2 =
    Mark.block "H2"
        (\children ->
            Html.h2 []
                children
        )
        text


header3 =
    Mark.block "H3"
        (\children ->
            Html.h3 []
                children
        )
        text


image =
    Mark.record "Image"
        (\src description ->
            Html.img
                [ Attr.src src
                , Attr.alt description
                ]
                []
        )
        |> Mark.field "src" Mark.string
        |> Mark.field "description" Mark.string
        |> Mark.toBlock


code =
    Mark.record "Code"
        (\lang str ->
            Html.pre [] [ Html.code [ Attr.class lang ] [ Html.text str ] ]
        )
        |> Mark.field "lang" Mark.string
        |> Mark.field "code" Mark.string
        |> Mark.toBlock



{- Handling bulleted and numbered lists - taken from elm-markup examples -}


list : Mark.Block (Html Never)
list =
    Mark.tree "List" renderList (Mark.map (Html.div []) text)



{- Note: we have to define this as a separate function because
   -- `Items` and `Node` are a pair of mutually recursive data structures.
   -- It's easiest to render them using two separate functions:
   -- renderList and renderItem
-}


renderList : Mark.Enumerated (Html Never) -> Html Never
renderList (Mark.Enumerated enum) =
    let
        group =
            case enum.icon of
                Mark.Bullet ->
                    Html.ul

                Mark.Number ->
                    Html.ol
    in
    group []
        (List.map renderItem enum.items)


renderItem : Mark.Item (Html Never) -> Html Never
renderItem (Mark.Item item) =
    Html.li []
        [ Html.div [] item.content
        , renderList item.children
        ]
