import { env } from "../../config/env.js";

export const oauthProviders = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize?force_verify=true&prompt=consent",
    tokenUrl: "https://github.com/login/oauth/access_token",
    reposApiUrl: "https://api.github.com/user/repos?per_page=100&sort=updated",
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    redirectUri: env.GITHUB_REDIRECT_URI,
    scope: "repo read:org"
  },
  gitlab: {
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    reposApiUrl: "https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at",
    clientId: env.GITLAB_CLIENT_ID,
    clientSecret: env.GITLAB_CLIENT_SECRET,
    redirectUri: env.GITLAB_REDIRECT_URI,
    scope: "read_api read_repository"
  },
  bitbucket: {
    authorizeUrl: "https://bitbucket.org/site/oauth2/authorize",
    tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
    reposApiUrl: "https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100",
    clientId: env.BITBUCKET_CLIENT_ID,
    clientSecret: env.BITBUCKET_CLIENT_SECRET,
    redirectUri: env.BITBUCKET_REDIRECT_URI,
    scope: "repository"
  }
};
