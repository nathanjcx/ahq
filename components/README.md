# Components

## One directory per page

`inbox/`, `employees/`, `tasks/`, `files/`, `activity/`, `marketplace/`, `integrations/`, `floors/`,
`admin/`. A directory holds its page component and every part only that page uses. A page directory
never imports from another page directory — if two pages need the same thing, it belongs in
`shared/`. The exceptions are `floors/`, which renders `office/` because the floor page is the
office, and `calendar/`, which renders `meetings/` because a meeting is the calendar's detail.

`app/` is the shell, not a page: the sidebar, the top bar, the panels that open over any page, the
review bar, and `page-content.tsx`, which picks the page to render. The shell imports pages; pages
do not import the shell, except for the `Actions` and `Page` types it passes down as props.

## Shared primitives

`shared/` holds what more than one page uses: `sheet`, `empty`, `marks`, `skeleton`,
`master-detail`, `overflow-menu`, `page-intro`, `json-view`, `state-diff`, `tool-checklist`,
`use-copy`, `use-media`. Two things live there as well:

- `shared/format.ts`: domain labels — what a provider, a model, a status, or a file is called.
- `shared/time.ts`: clock and calendar text for the viewer's locale. Timezone and working-hours
  arithmetic is `lib/time.ts`, which takes its zone explicitly and is pure.

Text shortening, counting, and slugs are `lib/text.ts`, which the routes and the tests share.

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
