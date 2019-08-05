module Styles exposing (styles)

import Css exposing (..)
import Css.Global exposing (..)
import Css.Media as Media exposing (..)
import Html exposing (Html)
import Html.Styled


styles : Html msg
styles =
    let
        wideScreen =
            withMedia [ only screen [ Media.minWidth <| Css.px 600 ] ]

        codeStyle =
            [ fontFamilies [ "Inconsolata", .value monospace ]
            ]
    in
    global
        [ body
            [ padding <| px 0
            , margin <| px 0
            , backgroundColor <| hex "ffffff"
            , Css.color <| hex "363636"
            , fontFamilies [ "Open Sans", "Arial", .value sansSerif ]
            , fontSize <| px 18
            , lineHeight <| Css.em 1.4
            ]
        , a
            [ Css.color <| hex "348aa7"
            , textDecoration none
            ]
        , code codeStyle
        , Css.Global.pre
            [ descendants
                [ code [ important <| overflowX Css.scroll ] ]
            ]
        , each [ h1, h2, h3, h4, h5, h6 ]
            [ fontFamilies [ "Proza Libre", "Helvetica", .value sansSerif ]
            , lineHeight <| Css.em 1.1
            ]
        , h1 [ fontSize <| Css.em 2.66667, marginBottom <| rem 2.0202 ]
        , h2 [ fontSize <| Css.em 2.0, marginBottom <| rem 1.61616 ]
        , h3 [ fontSize <| Css.em 1.33333, marginBottom <| rem 1.21212 ]
        , h4 [ fontSize <| Css.em 1.2, marginBottom <| rem 0.80808 ]
        , each [ h5, h6 ] [ fontSize <| Css.em 1.0, marginBottom <| rem 0.60606 ]
        , p [ margin3 auto auto (rem 1.5) ]
        , Css.Global.small [ fontSize <| pct 65 ]
        , class "header-logo"
            [ paddingTop <| px 6
            , textAlign center
            , backgroundColor <| hex "f2fae8"
            , wideScreen [ textAlign left, borderBottom3 (px 2) solid (hex "3c8765") ]
            ]
        , class "navigation"
            [ textAlign center
            , borderBottom3 (px 2) solid (hex "3c8765")
            , backgroundColor <| hex "f2fae8"
            , padding <| px 10
            , marginTop <| px -20
            , descendants
                [ ul
                    [ margin <| px 0
                    , padding <| px 0
                    , wideScreen [ lineHeight <| px 100 ]
                    ]
                , li
                    [ display inlineBlock
                    , marginRight <| px 20
                    ]
                ]
            , wideScreen [ marginTop <| px 0, padding <| px 0, textAlign right ]
            ]
        , class "content" [ Css.maxWidth <| vw 100 ]
        , class "footer"
            [ textAlign center
            , borderTop3 (px 2) solid (hex "2f4858")
            , backgroundColor <| hex "348aa7"
            , Css.color <| hex "ffffff"
            , descendants
                [ a [ Css.color <| hex "ffffff", textDecoration none ]
                , svg [ paddingRight <| px 5, verticalAlign baseline ]
                ]
            , wideScreen
                [ lineHeight <| px 80
                , textAlign right
                , descendants
                    [ class "link"
                        [ display inlineBlock
                        , marginRight <| px 20
                        ]
                    ]
                ]
            ]
        , class "post-metadata"
            [ marginTop <| Css.em -0.5
            , marginBottom <| Css.em 2.0
            , descendants
                [ each [ a, span ]
                    [ display inlineBlock
                    , marginRight <| px 5
                    ]
                , a
                    [ border3 (px 1) solid (hex "e0e0e0")
                    , borderRadius <| px 3
                    , backgroundColor <| hex "f2fae8"
                    , paddingLeft <| px 5
                    , paddingRight <| px 5
                    ]
                ]
            ]
        ]
        |> Html.Styled.toUnstyled
