# Weekly meeting sign-up

A small sign-up site for weekly student meetings.

- **You** (`admin.html`): drag on a week grid to mark when you're free, then publish to get that week's link. You can use 15- or 30-minute slots.
- **Students** (`index.html?week=…`): choose at least 3 slots and as many as possible. Then they say what they want to talk about and how much time they think they need.
- **Responses**: a heatmap of who's free when, each student's notes, and a **Suggest schedule** button. It fits everyone's requested time into your free slots with no overlaps.

Students only ever see the website. Responses are stored in a Google Sheet behind the scenes, and only you can read them.

## Try it first (no setup)

With `config.js` left empty, the site runs in **demo mode**: everything is saved in your own browser only. Open `admin.html`, publish a week, then click **Student view** to see what students get. In demo mode every "student" is you in the same browser, so a second submission replaces the first. To see several students, open the **Responses** tab and click **Add sample students (demo)**, then **Suggest schedule**.

## One-time setup (about 10 minutes)

### 1. Backend: Google Sheet + Apps Script

Use a **personal Gmail account**. University-managed Google accounts often block the "Anyone" access that students need.

1. Create a new Google Sheet, for example "Meeting sign-ups".
2. In the Sheet, choose **Extensions → Apps Script**. Delete what's in the editor and paste in all of [`apps-script/Code.gs`](apps-script/Code.gs).
3. On the first line, change `ADMIN_KEY = 'CHANGE-ME'` to a long passphrase only you know. Save with ⌘S.
4. In the toolbar's function menu, pick **`setup`** and press **▶ Run**. Google asks for permission:
   **Review permissions → your account → Advanced → Go to … (unsafe) → Allow**. The warning appears because this is your own unpublished script. It only touches this one spreadsheet.
5. Choose **Deploy → New deployment**. Click the ⚙︎ icon, pick **Web app**, and set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**, then copy the **Web app URL**. It ends in `/exec`.
6. Paste that URL into `config.js`:
   ```js
   window.MEET_CONFIG = { apiUrl: "https://script.google.com/macros/s/…/exec" };
   ```

"Anyone" means anyone with the link can *submit* a response. Reading responses, editing weeks and deleting require your admin key.

### 2. Website: GitHub Pages

1. Put this folder in a GitHub repository. GitHub Pages is free for public repos, and nothing private lives in the code.
2. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and click Save.
3. After about a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.
   - Your page: `…/admin.html`. It asks for the admin key once per browser.
   - Student links look like `…/?week=2026-11-16`. The bare `…/` link always opens the current open week.

## Calendar busy times and email alerts

- **Busy times.** The availability grid shows gray striped blocks wherever your Google Calendar is busy. Only free/busy is read, never event titles. If a time you offer overlaps a busy block, it gets red stripes. The calendars it checks are listed under ⚙︎ Settings → *Calendars to show as busy*. `primary` means the calendar of the Google account that owns the Apps Script.
- **Adding a work or university calendar.**
  1. In that calendar's Google Calendar settings, go to **Share with specific people** and add the Google account that owns the script with **See only free/busy**.
  2. Copy the calendar's ID (under *Integrate calendar*; for your main calendar it's your email address).
  3. Add the ID to the Settings list, separated by a comma.
  4. If the site can't read a calendar, an orange note appears above the grid.
- **Email alerts.** Each new or updated response emails the Google account that owns the script. The email has the student's name, time needed, topic, availability and a link to the Responses tab. Replying goes to the student if they gave an email. Turn alerts off in ⚙︎ Settings.
- These features need the permissions listed in [`apps-script/appsscript.json`](apps-script/appsscript.json): this spreadsheet only, read-only calendar, send email as you, and your email address. To set them up, paste that file in the editor after turning on *Project Settings → Show "appsscript.json" manifest file*.

## Each week

1. Open `admin.html`. Use ‹ › to pick the week.
2. Drag on the grid to mark your free times, or click **Copy last week** and adjust.
3. Optional: change the slot length (15/30 min), the minimum number of slots per student, or add a note to students.
4. Click **Publish**. The student link appears on the right with a **Copy** button. Send it out.
5. Watch the **Responses** tab. Click a student to see only their times. Click **Suggest schedule** for a non-overlapping plan, then **Copy** it to email out. Students aren't notified automatically.
6. Turn off **Accepting responses** to close sign-ups.

A student who opens their link again sees their saved answer and can edit it until sign-ups close. Edits from the same browser update that response. A submission from another device, or under a different name, is saved as a separate response, so nobody can overwrite someone else's answer. If a student ends up with two, delete the older one in the Responses tab.

## Good to know

- **Time zone**: you set times in the time zone under ⚙︎ Settings. Students in another time zone automatically see them converted to their own local time, with a link to switch back to yours. Responses always show in your time zone.
- **Slot length** is saved per week. New weeks start at 15 min; switch to 30 in the toolbar if you like. It can't be changed once students have responded that week.
- **Minimum**: the default is 90 minutes of availability: 6 slots in a 15-minute week, 3 in a 30-minute week. Pick a different minimum from the menu if you prefer.
- **Time needed**: students choose 15 min, 30 min or 1 hr (in 30-minute weeks: 30 min or 1 hr).
- **The Sheet** has tabs `Weeks`, `Responses`, `Settings`. `Responses` is a readable backup of everything, but use the admin page to make changes.
- **Updating the backend code later**: paste the new code, then go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. That keeps the same URL. A *new* deployment would give you a new URL.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the server" | Check that `config.js` has the URL ending in `/exec` and that the deployment's access is **Anyone**. |
| "Set ADMIN_KEY in the Apps Script…" | You deployed before changing `ADMIN_KEY`. Change it, then deploy a new version (see above). |
| Admin page keeps asking for the key | The key you typed doesn't match `ADMIN_KEY` exactly (case matters). |
| Changes to `Code.gs` don't take effect | Deploy a new version of the existing deployment. Saving the code alone isn't enough. |

## Files

| File | What it is |
|---|---|
| `index.html`, `student.js` | Student sign-up page |
| `admin.html`, `admin.js` | Your page |
| `core.js` | Shared helpers, API client, demo-mode storage |
| `style.css` | Styles (light and dark mode, phone layout) |
| `config.js` | The backend URL |
| `apps-script/Code.gs` | The backend, pasted into Google Apps Script |
