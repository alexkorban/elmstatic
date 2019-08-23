workflow "Build & Test" {
  on = "push"
  resolves = ["Test"]
}

action "Build" {
  uses = "actions/npm@master"
  args = "install"
}

action "Install Elm" {
  needs = "Build"
  uses = "actions/npm@master"
  args = "install elm"
}

action "Test" {
  needs = "Install Elm"
  uses = "actions/npm@master"
  args = "test"
}
