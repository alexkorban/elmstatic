module Pages.About exposing (..)

import Element exposing (..)
import Element.Attributes exposing (..)
import Html
import Html.Attributes exposing (class)
import Json.Decode
import Markdown exposing (..)
import Page exposing (..)
import Tags exposing (..)


decode =
    Json.Decode.value


pageContent =
    """
You can write something about *yourself* here using `Markdown`.
"""


view : a -> Html.Html msg
view _ =
    Page.view Page.topLevelHeader
        [ Page.title "About the Author"
        , Page.markdown pageContent
        ]
