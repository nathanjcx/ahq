# Components

## One directory per page

`inbox/`, `employees/`, `tasks/`, `files/`, `activity/`, `marketplace/`, `integrations/`, `floors/`,
`projects/`, `calendar/`, `meetings/`, `records/`, `audit/`, `triage/`, `channels/`, `admin/`. A
directory holds its page component and every part only that page uses. A page directory never imports
from another page directory — if two pages need the same thing, it belongs in `shared/`. The
exceptions are `floors/`, which renders `office/` because the floor page is the office, and
`calendar/`, which renders `meetings/` because a meeting is the calendar's detail.

`office/` is not a page: it is the 3D office the floor page and the lobby mount, with its own pure
layout, activity, and replay modules. `app/settings/` is the settings panel's five sections; the
panel opens over any page, so it belongs to the shell rather than to a page of its own.

`app/` is the shell, not a page: the sidebar, the top bar, the panels that open over any page, the
review bar, and `page-content.tsx`, which picks the page to render. The shell imports pages; pages
do not import the shell, except for the `Actions` and `Page` types it passes down as props.

## Shared primitives

`shared/` holds what more than one page uses: `sheet`, `empty`, `marks`, `skeleton`,
`master-detail`, `overflow-menu`, `page-intro`, `json-view`, `state-diff`, `tool-checklist`,
`use-copy`, `use-media`, `members`, and the composites several pages mount — `channel-feed`
(a channel's posts and its composer), `employee-feed` (one instance's posts, wherever it wrote them),
and `hire-sheet` (hiring a count of one listing, and `hireContext` for who the viewer is where hiring
is concerned). Two things live there as well:

- `shared/format.ts`: domain labels — what a provider, a model, a status, or a file is called.
- `shared/time.ts`: clock and calendar text for the viewer's locale. Timezone and working-hours
  arithmetic is `lib/time.ts`, which takes its zone explicitly and is pure.

Text shortening, counting, and slugs are `lib/text.ts`, which the routes and the tests share.

## Queries the fixture can answer

Most pages read from the dashboard subscription the shell passes down. A page that owns a query calls
`useUiQuery(uiApi.xxx, args)` from `shared/use-ui-query.ts`, never `useQuery` directly. It is
`useQuery` against a live deployment, and under the fixture route `/qa` it answers from
`app/qa/fixtures/<domain>.ts` keyed by Convex function name — `'projects:list'`, `'channels:posts'` —
with a value or a function of the args. A new query needs its fixture answer in the same change, or
the page cannot be photographed.

## Actions per domain

Every workspace mutation goes through `app/actions/`, one file per domain, composed by
`app/actions/index.ts` into a single `Actions` object. A page takes the actions it needs as props
and calls them; it never calls `useMutation` itself. Arguments are typed in UI terms — plain string
ids, converted at the action.

## Stylesheets per directory

`app/globals.css` holds design tokens, the reset, and the primitives every page shares: buttons,
fields, pills, cards, sheets, empty states, skeletons, and the master-detail shell. Nothing in it
belongs to one page.

Each page directory has one stylesheet named after it — `inbox/inbox.css`, `tasks/tasks.css` — and
the page component imports it. A selector's leftmost class decides where it lives, so
`.integration-card .primary-button` is the integrations page's rule and `.primary-button` is the
shared one. Delete a selector when its last user goes.

## No inline styles

Use a class. The exception is a value that only the data knows: a listing's colour, an employee's
colour, a skeleton bar's width, a computed position. Pass those as a custom property where the
stylesheet needs to do anything with them:

```tsx
<span className="employee-avatar" style={{ '--employee-color': employee.color } as CSSProperties} />
```
