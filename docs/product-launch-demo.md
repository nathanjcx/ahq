# Astra HQ Product Launch demo

**Start demo** and **Reset** appear side by side, immediately left of the date in
the existing app header. Start plays the 28-second walkthrough using the normal
Employees page, New employee form, goal form, Roadmap, review dialogs, and Files
page. A moving cursor performs the clicks and types into those same controls.
There is no separate demo tab or replica workspace UI.

**Reset** prepares the three-person sample workspace without starting playback.
Choose **Start demo** to play or replay the walkthrough. **Exit demo** restores
the live workspace. While playback is running, **Stop demo** or Escape also exits
to the live workspace.

The existing Office chat opens automatically. All four employees exchange staged
updates about the product, forecast, Thrive Capital meeting, creative options,
and image handoff, then celebrate together when the work is approved.

The demo starts with a Software Engineer, Finance Bro, and Assistant. It creates
the Marketing Intern, enters the **Astra HQ Product Launch** goal, generates a
roadmap, and shows the team working. A fictional email from the Thrive Capital
team requests a product launch meeting. Avery, the Assistant, drafts a reply for
approval and prepares a sample calendar event for Thursday, October 15, 2026,
10:00–10:30 AM ET. The sample sender address is `team@thrivecapital.example`.

A sample bug becomes a reviewable pull request, Finance prepares potential profits,
and Marketing writes the slogan and HTML. The cursor swipes through three campaign
photo options and selects option 2. Morgan hands that image to Alex, the Software
Engineer, who reveals a landing page prepared before playback. After the final
approval, the walkthrough returns to **Office**. All seven sample files remain
available in **Files**.

Everything in this walkthrough is sample data. It does not modify the live
workspace, call AI services, send email, create remote pull requests, or add events
to a real calendar. Sample files remain available to inspect and download after
the walkthrough ends. Live sessions remain in the separate **Live office** tab.

## Sample assets

- `public/demo/profit-forecast.xlsx`: a formula-driven, illustrative October–December
  2026 forecast. Monthly customers: 100, 250, 500. Plan price: $29. Monthly costs:
  $1,600, $2,400, $3,800. Total revenue: $24,650; costs: $7,800; profit: $16,850.
  Authored with the bundled spreadsheet artifact tool. Verified cached Excel
  values, formula references, recalculation after a price change, and rendered layout.
- `public/demo/marketing-photo.png`: generated with the built-in image-generation
  tool for the Marketing Intern's scripted sample output. The image is created
  in advance so the demo can complete consistently in 28 seconds. Two additional
  options are documented below.
- `public/demo/astra-hq-landing-page.html`: a prepared, standalone sample landing
  page with product features and working links to its team and feature sections.
  It embeds the selected `marketing-photo-2.png` image, so the downloaded HTML
  opens on its own without a separate image file. Playback reveals this existing
  file after Marketing hands the selected image to Engineering; nothing is
  generated or published during the demo.

Image prompt: “A landscape marketing photo for Astra HQ, a warm miniature office
application where an AI team works together. A polished premium macro product
photograph of a physical miniature isometric office diorama resting on a warm ivory
studio surface. Four tiny stylized worker figurines collaborate at walnut desks:
a software engineer with a monitor, finance worker with spreadsheet pages,
marketing intern with a colorful art board, and assistant with a calendar. Sage
green partitions, cream walls, tiny indoor plants, warm brass details, soft
directional morning light, realistic miniature wood, paper, and fabric textures,
subtle depth of field. Elevated three-quarter camera showing the whole office,
generous breathing room. Clean cream and sage palette. No text, logos, letters,
watermarks, or unrelated objects. Landscape 3:2 composition.”

## Validation

On September 10, 2026, the native desktop walkthrough completed in 28 seconds
using the actual employee and goal forms, roadmap, review dialogs, and Files page.
Checks covered the typed Thrive Capital reply, approved calendar meeting,
selected second marketing photo, prepared landing-page preview, and return to
Office with chat open. All four employees contributed staged launch updates and
closing messages. An isolated component check verified the three pointer swipes, selected
image handoff, and reuse of that image in the landing page.

Reset returned to three starting employees, no goal, and zero sample files without
starting playback. Start replayed the walkthrough; Exit restored the saved live
goal and employees. Fixture snapshots passed the application schema throughout
the walkthrough, with no native session IDs. The standalone landing-page image and
in-page links were checked. The downloaded workbook matched the source asset
byte for byte and its formulas recalculated correctly.

Final `npm run check` passed: all 233 tests, the TypeScript check, the production
renderer build, and the desktop/speech-helper build. The built app was relaunched
with `npm start`.

The desktop window recording is saved at
`recordings/astra-hq-product-launch.mp4`: 29.5 seconds, 1470×836, H.264 MP4,
approximately 30 frames per second. It contains the complete 28-second run and
a brief final Office/chat hold. Only the Astra HQ window was captured, with no
audio or operating-system cursor; the app's scripted cursor is visible.
The video was trimmed from the actual window capture using AVFoundation.

Earlier announcement checks used an isolated simulated microphone harness,
including release, cancellation, focus changes, and recorder failure. macOS launch
and speech-helper diagnostics were checked without requesting microphone access.
Real microphone recognition still requires the user's first-use permission.

## Additional campaign photo options

Created with the built-in image-generation tool using `public/demo/marketing-photo.png` as a style reference. Both additional assets are landscape PNGs with four miniature workers and the cream, sage, walnut, and brass palette. They are generated in advance for deterministic demo playback.

- `public/demo/marketing-photo-2.png`: bright collaborative office with a central planning table and project board.
- `public/demo/marketing-photo-3.png`: warm twilight creative office with amber task lighting.

### Option 2 prompt

```text
Use case: ads-marketing. Create one distinct landscape 3:2 marketing photo option for Astra HQ. Input image is a STYLE REFERENCE ONLY: match its premium physical miniature diorama realism, tiny friendly stylized worker figurines, tactile wood/paper/fabric, and cream, sage green, walnut and brass palette. Do not reuse its cubicle composition. NEW OPTION: bright collaborative office seen from an elevated overhead three-quarter camera, with exactly four miniature workers gathered around a central walnut planning table and upright central project board carrying abstract colored notes and diagrams, plus a couple of neatly arranged computers and paper worksheets. The four workers represent a software engineer, finance worker, assistant and marketing intern, all comfortably collaborating, all clearly visible. Cutaway cream office walls, sage chairs, tiny plants, rounded furnishings, small brass lamps. Airy morning daylight, inviting optimistic atmosphere, beautiful soft shadows and high-end macro product photography. Compose the complete miniature office against a clean ivory studio background with generous breathing room around it, suitable for a website landing-page hero. New composition that feels clearly distinct from reference but the same miniature office world. Landscape 1536x1024. No legible writing, no title or logos, no watermark, no extra people, no floating interface or user-interface overlays.
```

### Option 3 prompt

```text
Use case: ads-marketing. Create one distinct landscape 3:2 marketing photo option for Astra HQ. Input image is a STYLE REFERENCE ONLY: match its premium physical miniature diorama realism, tiny friendly stylized worker figurines, tactile wood/paper/fabric, and cream, sage green, walnut and brass palette. Do not reuse its cubicle composition. NEW OPTION: a warm twilight creative studio in a complete miniature cutaway office. Exactly four miniature workers collaborate across an open walnut desk arrangement and a small central creative table: a software engineer at a softly glowing monitor, a finance worker reviewing a chart, an assistant organizing meeting cards, and a marketing intern arranging a campaign moodboard. All four workers clearly visible. Cream plaster walls, sage upholstery, walnut cabinetry, brass desk lamps, tiny indoor plants, art materials neatly arranged. Warm amber task lighting pools on the desks, with soft dusk-blue ambient light at the windows; cozy and sophisticated, calm creative energy after sunset. High-end macro product photography, realistic miniature textures, subtle depth of field while the complete room remains readable. Elevated three-quarter camera with generous breathing room around the diorama on a warm neutral studio surface. Clearly different from bright daytime reference yet part of the same miniature office world. Landscape 1536x1024. No legible writing, no title or logos, no watermark, no extra people, no floating interface or user-interface overlays.
```
