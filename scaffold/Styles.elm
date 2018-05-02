module Styles exposing (..)

import Css exposing (..)
import Css.Foreign exposing (..)
import Css.Colors exposing (..)
import Html
import Html.Styled
import Json.Decode


codeStyle =
    [ fontFamilies [ "Inconsolata", .value monospace ]
    , fontSize (Css.rem 1)
    ]


styles : Html.Html msg
styles =
    global
        [ class "markdown"
            [ descendants
                [ a [ color <| hex "348aa7" ]
                , each [ h1, h2, h3, h4, h5, h6 ] [ fontFamilies [ "Proza Libre", "Helvetica", .value sansSerif ] ]
                , code codeStyle
                , Css.Foreign.pre
                    [ descendants [ code codeStyle ] ]
                ]
            , property "pointer-events" "auto"
            ]
        ]
        |> Html.Styled.toUnstyled
