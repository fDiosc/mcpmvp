import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const jiraBaseUrl = process.env.JIRA_BASE_URL;
const jiraUser = process.env.JIRA_USERNAME;
const jiraToken = process.env.JIRA_API_TOKEN;
const issueKey = process.argv[2] || 'CR-618';

console.log('[DEBUG][JIRA] JIRA_BASE_URL:', jiraBaseUrl);
console.log('[DEBUG][JIRA] JIRA_USERNAME:', jiraUser);
console.log('[DEBUG][JIRA] JIRA_API_TOKEN:', jiraToken ? jiraToken.slice(0, 4) + '...' : undefined);

if (!jiraBaseUrl || !jiraUser || !jiraToken) {
  console.error('Jira credentials are not configured in the environment.');
  process.exit(1);
}

const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}`;
const auth = Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64');

fetch(url, {
  headers: {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json'
  }
})
  .then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] Status: ${response.status} ${response.statusText}`);
      console.error(errorText);
      process.exit(1);
    }
    const data = await response.json();
    console.log('[SUCCESS] Issue fetched:', data.key);
    console.log('Summary:', data.fields.summary);
    console.log('Status:', data.fields.status.name);
  })
  .catch((err) => {
    console.error('[ERROR] Exception:', err);
    process.exit(1);
  }); 