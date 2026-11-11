{
  "name": "Acme",
  "folder": "~/cwd/acme",
  "claude": null,
  "jira": {"url": "https://acme.atlassian.net/jira/software/projects/ACME/boards/7", "site": "https://acme.atlassian.net", "board": 7, "keychain": "jira-acme"},
  "github": {"owner": "acme"},
  "notify": {"pulls": true},
  "commands": {"leftovers": "sh scripts/story.sh leftovers {key}", "cleanUp": "sh scripts/story.sh clean {key}"}
}
