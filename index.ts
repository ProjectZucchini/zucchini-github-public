import { App, createNodeMiddleware } from 'octokit';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

require('dotenv').config();

const GH_COMMAND = 'zucchini';

const app = new App({
  appId: process.env.APP_ID,
  privateKey: fs.readFileSync(process.env.PRIVATE_KEY_FILE, 'utf-8'),
  oauth: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  },
  webhooks: {
    secret: process.env.WEBHOOK_SECRET,
  },
});

app.webhooks.on('issue_comment.created', handleIssueComment);

http.createServer(createNodeMiddleware(app)).listen(3000);

function handleIssueComment({octokit, payload}) {
  if (payload.comment.body.startsWith(GH_COMMAND)) {
    if (payload.comment.body.startsWith('plan', 9)) {
      handlePlanCommand(octokit, payload);
    }
    if (payload.comment.body.startsWith('apply', 9)) {
      handleApplyCommand(octokit, payload);
    }
  }
}

async function handlePlanCommand(octokit, payload) {
  const response = await octokit.rest.pulls.get({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.issue.number,
  });

  const commentId = await createPlanComment(octokit, payload);
  cloneRepo(payload.repository.ssh_url);
  checkoutBranch(response.data.head.ref);
  initTerraform();
  planTerraform(octokit, payload, commentId);
}


async function handleApplyCommand(octokit, payload) {
  const response = await octokit.rest.pulls.get({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.issue.number,
  });

  const commentId = await createApplyComment(octokit, payload);
  cloneRepo(payload.repository.ssh_url);
  checkoutBranch(response.data.head.ref);
  initTerraform();
  applyTerraform(octokit, payload, commentId);
}

async function createPlanComment(octokit, payload) {
  const response = await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: `\`${GH_COMMAND} plan\` initiated! <br><br> Waiting for results...`,
  });

  return response.data.id;
}

async function createApplyComment(octokit, payload) {
  const response = await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: `\`${GH_COMMAND} apply\` initiated! <br><br> Waiting for results...`,
  });

  return response.data.id;
}

function cloneRepo(gitUrl) {
  if (fs.existsSync('/tmp/zucchini')) {
    fs.rmSync('/tmp/zucchini', { recursive: true });
  }

  fs.mkdirSync('/tmp/zucchini');

  child_process.execSync(`git clone ${gitUrl} /tmp/zucchini`, {
    stdio: 'pipe',
  });
}

function checkoutBranch(branchName) {
  child_process.execSync(`git checkout ${branchName}`, {
    cwd: '/tmp/zucchini',
    stdio: 'pipe',
  });
}

function initTerraform() {
  child_process.execSync('terraform init', {
    cwd: '/tmp/zucchini',
  });
}

function planTerraform(octokit, payload, commentId) {
  let commentBody;
  try {
    const result =  child_process.execSync('terraform plan -no-color', {
      cwd: '/tmp/zucchini',
      encoding: 'utf8',
    });
    commentBody = `
\`${GH_COMMAND} plan\` has completed successfully! :tada:

See the output below:
<details>
<summary><b>Output</b></summary>

\`\`\`
${result}
\`\`\`

</details>

To apply this change, run \`${GH_COMMAND} apply\` :rocket:
`
  } catch (error) {
    commentBody = `
:rotating_light::rotating_light::rotating_light::rotating_light::rotating_light:
\`${GH_COMMAND} plan\` has failed!
:rotating_light::rotating_light::rotating_light::rotating_light::rotating_light:

See the output below:
<details>
<summary><b>Output</b></summary>

\`\`\`
${error.stderr}
\`\`\`

</details>

Please fix the issue and run \`${GH_COMMAND} plan\` again
`
  }

  octokit.rest.issues.updateComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    comment_id: commentId,
    body: commentBody
  });
}

function applyTerraform(octokit, payload, commentId) {
  let commentBody;
  try {
    const result =  child_process.execSync('terraform apply -auto-approve -no-color', {
      cwd: path.join(process.cwd(), '/tmp'),
      encoding: 'utf8',
    });
    commentBody = `
\`${GH_COMMAND} apply\` has completed successfully! :tada:

See the output below:
<details>
<summary><b>Output</b></summary>

\`\`\`
${result}
\`\`\`

</details>
`
  } catch (error) {
    commentBody = `
:rotating_light::rotating_light::rotating_light::rotating_light::rotating_light:
\`${GH_COMMAND} apply\` has failed!
:rotating_light::rotating_light::rotating_light::rotating_light::rotating_light:

See the output below:
<details>
<summary><b>Output</b></summary>

\`\`\`
${error.stderr}
\`\`\`

</details>
`
  }

  octokit.rest.issues.updateComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    comment_id: commentId,
    body: commentBody
  });
}