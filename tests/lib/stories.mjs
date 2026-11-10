// Story data for the logic tests: the demo profile loaded as the story list loads it (its fixture,
// demo/demo.json, through demo.js), and small hand-built Jira and GitHub data in the shapes the
// list keeps (stories.js issue() and pull()). Import after "herdr" so the stub is in place.
import { StoryList } from "../../mods/kelpie/stories.js";

// The demo profile as kelpie.demo saves it (demo.js setupDemo), in a folder that doesn't exist.
export const DEMO_PROFILE = Object.freeze({
  id: "demo", name: "Acme", folder: "/nonexistent/kelpie-demo/acme", demo: true, claude: null,
  jira: { url: "https://jira.example.com/jira/software/projects/ACME/boards/7", site: "https://jira.example.com", board: 7, demo: true },
  github: { owner: "kelpie--demo", demo: true },
});

// What the story list's load gives for the demo (StoryList.fetch, every request answered by demo.js).
export async function demoData(profile = DEMO_PROFILE) {
  const setup = { saved: true, profile, folder: profile.folder, jira: profile.jira, github: profile.github };
  return new StoryList().fetch({ space: null, setup });
}

// A small board: To Do, In Progress, QA (the default handover column), Done.
export const COLUMNS = [
  { name: "To Do", statuses: ["1"] }, { name: "In Progress", statuses: ["2"] }, { name: "QA", statuses: ["3"] }, { name: "Done", statuses: ["4"] },
];
const STATUS = {
  todo: { id: "1", name: "To Do", statusCategory: { key: "new" } },
  doing: { id: "2", name: "In Progress", statusCategory: { key: "indeterminate" } },
  blocked: { id: "2", name: "Blocked", statusCategory: { key: "indeterminate" } },
  qa: { id: "3", name: "In QA", statusCategory: { key: "indeterminate" } },
  done: { id: "4", name: "Done", statusCategory: { key: "done" } },
};
// An issue as the list keeps it: `parent` makes it a subtask.
export const issue = (key, status = "todo", parent = null) => ({
  key, fields: { summary: `${key} title`, issuetype: { name: parent ? "Sub-task" : "Story", subtask: Boolean(parent) }, status: STATUS[status], parent: parent ? { key: parent } : null },
});
// A pull request as the list keeps it.
export const pr = (title, { checks = null, review = null, merged = false, draft = false, repo = "api", number = 1, author = "you" } = {}) => ({
  number, title, url: `https://github.com/kelpie--demo/${repo}/pull/${number}`, isDraft: draft, reviewDecision: review, merged,
  author: { login: author }, repository: { name: repo }, commits: { nodes: [{ commit: { statusCheckRollup: { state: checks } } }] },
});
// A load's data: `parents` the stories (and tasks), `children` their subtasks, `mine` the keys
// assigned to you.
export const data = ({ parents = [], children = [], mine = [], prs = [], sessions = [], reviews = [], columns = COLUMNS } = {}) => ({
  site: "https://jira.example.com", columns, sprints: [{ id: 1, name: "Sprint 1" }], mine: mine.map((key) => ({ key })), parents, children, prs, sessions, reviews,
});
