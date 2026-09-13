import { LegalPage } from '../legal';

export const metadata = { title: 'Terms of service · Staff AI' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="September 13, 2026">
      <h2>The service</h2>
      <p>
        Staff AI, operated by trystaff (&quot;we&quot;), lets a team run AI staff that carry out tasks using
        the tools the team connects. By creating an account or using app.trystaff.ai you agree to these terms.
      </p>
      <h2>Your account and workspace</h2>
      <p>
        You are responsible for the credentials you use to sign in and for what happens under your account. A
        workspace owner is responsible for the people they invite and the tools they connect.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Use the service only for lawful purposes and only with tools and data you are entitled to use. Do not
        attempt to circumvent approvals, access another workspace, or interfere with the service.
      </p>
      <h2>AI staff and approvals</h2>
      <p>
        The AI staff act on instructions from your team. Actions that change something outside the workspace
        are proposed first and run only when a person approves them. Review what is proposed; you remain
        responsible for the actions you approve.
      </p>
      <h2>Your content</h2>
      <p>
        You keep ownership of what you put into the workspace and what the AI staff produce for you. You give
        us the permission needed to store and process it to provide the service.
      </p>
      <h2>Availability and changes</h2>
      <p>
        We may change or discontinue features. We will make reasonable efforts to keep the service available
        but do not guarantee uninterrupted operation.
      </p>
      <h2>Disclaimer and liability</h2>
      <p>
        The service is provided as is. To the extent the law allows, we are not liable for indirect or
        consequential losses, and our total liability for any claim is limited to the amount you paid for the
        service in the twelve months before the claim.
      </p>
      <h2>Termination</h2>
      <p>You can stop using the service at any time. We may suspend accounts that break these terms.</p>
      <h2>Contact</h2>
      <p>Questions about these terms go to spencer@trystaff.ai.</p>
    </LegalPage>
  );
}
