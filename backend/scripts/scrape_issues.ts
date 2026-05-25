import { access, mkdir, writeFile } from 'node:fs/promises';
import path, { dirname } from 'node:path';

const GITLAB_TOKEN = '';
const PROJECT_ID = '';

const OUTPUT_DIR = path.resolve(
  dirname(new URL(import.meta.url).pathname),
  '../../.data/documents',
);
const PER_PAGE = 100;
const DELAY_MS = 150;

const api = async (url: string, options: RequestInit = {}) => {
  const response = await fetch('https://gitlab.com/api/v4' + url, {
    headers: {
      'PRIVATE-TOKEN': GITLAB_TOKEN,
    },
    ...options,
  });
  return response.json();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

async function fetchAllIssues() {
  if (!(await exists(OUTPUT_DIR))) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  let total = 0;
  let page = 1;

  while (true) {
    const res = await api(
      `/projects/${encodeURIComponent(PROJECT_ID)}/issues?state=all&page=${page}&per_page=${PER_PAGE}&order_by=updated_at&sort=asc`,
    );

    const issues = res;

    if (!issues.length) break;

    for (const issue of issues) {
      const filePath = path.join(OUTPUT_DIR, `${issue.iid}.md`);

      const { title, description, ...metadata } = issue;
      const frontmatter = `- id: ${issue.id}
- iid: ${issue.iid}
- project_id: ${issue.project_id}
- state: ${issue.state}
- created_at: ${issue.created_at}
- updated_at: ${issue.updated_at}
- closed_at: ${issue.closed_at}
- closed_by: ${issue.closed_by ? issue.closed_by.name : 'null'}
- labels: ${issue.labels.join(', ')}
- assignees: ${issue.assignees.map((a: any) => a.name).join(', ')}
- author: ${issue.author ? issue.author.name : 'null'}
- type: ${issue.type}
- assignee: ${issue.assignee ? issue.assignee.name : 'null'}
- merge_requests_count: ${issue.merge_requests_count}
- start_date: ${issue.start_date}
- due_date: ${issue.due_date}
- issue_type: ${issue.issue_type}
- web_url: ${issue.web_url}
- weight: ${issue.weight}
- blocking_issues_count: ${issue.blocking_issues_count}
- has_tasks: ${issue.has_tasks}
- task_status: ${issue.task_status}
- moved_to_id: ${issue.moved_to_id}
- epic: ${issue.epic ? issue.epic.name : 'null'}
- iteration: ${issue.iteration ? `${issue.iteration.name} (${issue.iteration.start_date} - ${issue.iteration.end_date})` : 'null'}`;
      const body = `# ${title}\n\n${description ?? ''}`;

      await writeFile(filePath, `---\n${frontmatter}\n---\n\n${body}\n`);

      total++;
    }

    page++;
    console.log(`Saved: ${total}`);

    await sleep(DELAY_MS);
  }

  console.log(`✅ Done. Total saved: ${total}`);
}

fetchAllIssues().catch(async (err) => {
  if (err.response?.status === 429) {
    const retryAfter = err.response.headers['retry-after'] || 5;
    console.log(`Rate limited. Retry in ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return fetchAllIssues();
  }

  console.error(err.message);
});
