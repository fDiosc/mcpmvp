export interface UserJiraCredentials {
  baseUrl: string;
  username: string;
  apiToken: string;
}

export interface RequestContext {
  userJiraCredentials?: UserJiraCredentials;
  productLabUserId?: string; // Optional: If you plan to send a ProductLab user identifier
  // Add other request-specific data as needed in the future
} 