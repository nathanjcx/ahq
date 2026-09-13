import { LegalPage } from '../legal';

export const metadata = { title: 'Privacy policy · Staff AI' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 13, 2026">
      <h2>What Staff AI is</h2>
      <p>
        Staff AI, operated by trystaff (&quot;we&quot;), is a workspace where a team runs AI staff that carry
        out tasks against the tools the team connects. This policy describes what we collect when you use the
        application at app.trystaff.ai and what we do with it.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your name and email address, provided by the identity provider
          you sign in with (email, password, a one-time code, or Google). If you sign in with Google we
          receive your basic profile and email; we do not receive your Google password and we do not access
          other Google data unless you connect a Google integration separately.
        </li>
        <li>
          <strong>Workspace content.</strong> The tasks, messages, files, notes, and settings you and your
          team create in the workspace, and the records the AI staff produce while working on them.
        </li>
        <li>
          <strong>Connected tools.</strong> When you connect a third-party service, we store the credential
          needed to act on your behalf, encrypted, and the results of the actions you approve. Every external
          write is proposed first and runs only after a person approves it.
        </li>
        <li>
          <strong>Usage records.</strong> Model usage, timestamps, and an audit trail of what each AI employee
          did, so the team can review it.
        </li>
      </ul>
      <h2>How we use it</h2>
      <p>
        To run the service you asked for, to show your team what happened, to enforce the workspace&apos;s
        permissions, and to keep the service reliable and secure. We do not sell personal information and we
        do not use your workspace content to train models.
      </p>
      <h2>Who else sees it</h2>
      <p>
        Members of your workspace, according to the sharing settings you choose. Service providers that host
        the application and run the AI models process data on our behalf under contract. We disclose
        information when the law requires it.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Workspace content stays for as long as the workspace exists. A workspace owner can delete tasks,
        connections, and the workspace itself. Email us to request deletion of your account.
      </p>
      <h2>Security</h2>
      <p>
        Stored credentials are encrypted at rest with keys the application servers hold and the database never
        sees. Access to the service is over HTTPS only.
      </p>
      <h2>Changes</h2>
      <p>We will post updates to this page and change the date above when the policy changes.</p>
    </LegalPage>
  );
}
