/**
 * Domain DTOs for the GitHub module. Nothing outside src/modules/github/
 * should ever see an Octokit request/response object directly — every
 * public function here returns one of these normalized shapes instead.
 */

export type GithubIdentity = {
  githubUserId: number;
  githubLogin: string;
};

export type InstallationAccountType = "User" | "Organization";

export type VerifiedInstallation = {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: InstallationAccountType;
  repositorySelection: "all" | "selected";
};

export type RepositorySummary = {
  githubRepositoryId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
};
