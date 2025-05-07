import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const jiraBaseUrl = process.env.JIRA_BASE_URL;
const jiraUser = process.env.JIRA_USERNAME;
const jiraToken = process.env.JIRA_API_TOKEN;
const issueKey = process.argv[2] || 'CR-618';  // Default issue key if not provided

console.log('[TEST] Jira Tools Test');
console.log('===========================================');
console.log('[CONFIG] JIRA_BASE_URL:', jiraBaseUrl);
console.log('[CONFIG] JIRA_USERNAME:', jiraUser);
console.log('[CONFIG] JIRA_API_TOKEN:', jiraToken ? jiraToken.slice(0, 4) + '...' : undefined);
console.log('[CONFIG] Testing with Issue Key:', issueKey);
console.log('===========================================');

if (!jiraBaseUrl || !jiraUser || !jiraToken) {
  console.error('[ERROR] Jira credentials are not configured in the environment.');
  process.exit(1);
}

// Common utility for Jira authentication
function getJiraAuth() {
  return Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64');
}

// Common utility for API calls
async function callJiraApi(endpoint) {
  const url = `${jiraBaseUrl}${endpoint}`;
  const auth = getJiraAuth();
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Test functions
async function testGetDetailedJiraIssue() {
  console.log('\n[TEST] getDetailedJiraIssue');
  try {
    const endpoint = `/rest/api/3/issue/${issueKey}?fields=summary,description,status,assignee,priority`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Detailed issue fetched:', data.key);
    console.log('Summary:', data.fields?.summary);
    console.log('Status:', data.fields?.status?.name);
    console.log('Assignee:', data.fields?.assignee?.displayName || 'Unassigned');
    console.log('Priority:', data.fields?.priority?.name);
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testGetJiraIssueComments() {
  console.log('\n[TEST] getJiraIssueComments');
  try {
    const endpoint = `/rest/api/3/issue/${issueKey}/comment`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Comments fetched:', data.total, 'comments found');
    if (data.comments && data.comments.length > 0) {
      console.log('First comment by:', data.comments[0]?.author?.displayName);
      console.log('Comment excerpt:', data.comments[0]?.body?.substring(0, 50) + '...');
    } else {
      console.log('No comments found.');
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testGetJiraIssueTransitions() {
  console.log('\n[TEST] getJiraIssueTransitions');
  try {
    const endpoint = `/rest/api/3/issue/${issueKey}/transitions`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Transitions fetched:', data.transitions.length, 'transitions available');
    data.transitions.forEach(transition => {
      console.log(`- ${transition.name} (to ${transition.to.name})`);
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testSearchJiraIssues() {
  console.log('\n[TEST] searchJiraIssues');
  try {
    // Simple JQL query to find up to 5 issues in the same project
    const projectKey = issueKey.split('-')[0];
    const jql = `project=${projectKey} ORDER BY created DESC`;
    const endpoint = `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=5`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Search results:', data.total, 'issues found');
    data.issues.forEach(issue => {
      console.log(`- ${issue.key}: ${issue.fields.summary} (${issue.fields.status.name})`);
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testGetJiraIssueWatchers() {
  console.log('\n[TEST] getJiraIssueWatchers');
  try {
    const endpoint = `/rest/api/3/issue/${issueKey}/watchers`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Watchers fetched:', data.watchCount, 'watchers found');
    if (data.watchers && data.watchers.length > 0) {
      data.watchers.forEach(watcher => {
        console.log(`- ${watcher.displayName} (${watcher.emailAddress})`);
      });
    } else {
      console.log('No watchers found.');
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testGetJiraIssueAttachments() {
  console.log('\n[TEST] getJiraIssueAttachments');
  try {
    const endpoint = `/rest/api/3/issue/${issueKey}?fields=attachment`;
    const data = await callJiraApi(endpoint);
    const attachments = data.fields?.attachment || [];
    console.log('[SUCCESS] Attachments fetched:', attachments.length, 'attachments found');
    attachments.forEach(attachment => {
      console.log(`- ${attachment.filename} (${attachment.mimeType}, ${attachment.size} bytes)`);
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

async function testGetJiraIssueSprints() {
  console.log('\n[TEST] getJiraIssueSprints');
  try {
    const endpoint = `/rest/agile/1.0/issue/${issueKey}?fields=sprint,closedSprints,project`;
    const data = await callJiraApi(endpoint);
    console.log('[SUCCESS] Sprint information fetched');
    
    // Current sprint
    if (data.fields?.sprint) {
      console.log('Current Sprint:', data.fields.sprint.name);
      console.log('Sprint State:', data.fields.sprint.state);
      console.log('Sprint Dates:', data.fields.sprint.startDate, 'to', data.fields.sprint.endDate);
    } else {
      console.log('Not in any current sprint.');
    }
    
    // Closed sprints
    if (data.fields?.closedSprints && data.fields.closedSprints.length > 0) {
      console.log('\nClosed Sprints:', data.fields.closedSprints.length);
      data.fields.closedSprints.forEach(sprint => {
        console.log(`- ${sprint.name} (${sprint.state})`);
      });
    } else {
      console.log('No closed sprints found.');
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    console.log('Note: This feature requires Jira Software and the Agile API.');
  }
}

// Run all tests
async function runAllTests() {
  try {
    await testGetDetailedJiraIssue();
    await testGetJiraIssueComments();
    await testGetJiraIssueTransitions();
    await testSearchJiraIssues();
    await testGetJiraIssueWatchers();
    await testGetJiraIssueAttachments();
    await testGetJiraIssueSprints();
    
    console.log('\n[TEST] All tests completed.');
  } catch (err) {
    console.error('\n[ERROR] Test suite failed:', err.message);
  }
}

runAllTests(); 