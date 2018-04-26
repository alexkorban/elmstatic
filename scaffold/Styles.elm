module Styles exposing (..)

import Css exposing (..)
import Css.Foreign exposing (..)
import Css.Colors exposing (..)
import Html
import Html.Styled
import Json.Decode

codeStyle = 
    [ fontFamily [ "Inconsolata", monospace ]
    , fontSize (rem 1)
    ]

styles : Html.Html msg
styles =
    global
        , class "markdown"
            [ descendants
                [ a [ color <| hex "348aa7" ] ]
            , each [ h1, h2, h3, h4, h5, h6 ] [ fontFamily [ "Proza Libre", "Helvetica", sansSerif ] ]
            , code codeStyle 
            , pre 
                [ descendants [ code codeStyle ] ]
            ]
        ]
        |> Html.Styled.toUnstyled
