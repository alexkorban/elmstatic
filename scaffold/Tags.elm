module Tags exposing (..)

import String exposing (toLower)


type Tag
    = Books
    | Personal
    | Software
    | UnknownTag -- This is required


fromString : String -> Tag
fromString s =
    case toLower s of
        "books" ->
            Books

        "personal" ->
            Personal

        "software" ->
            Software

        _ ->
            UnknownTag
