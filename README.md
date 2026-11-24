# Receipt Book: setup guide

Receipt Book is your own expense tracker. It runs on your phone as a home-screen app and reads receipts on the phone itself. It can sync through a Google Sheet in your own Google account. Nothing goes through Claude or any AI service.

Setup takes about 20 minutes, once. There are three parts:

1. Put the app online (free, with GitHub Pages)
2. Connect your Google Sheet (free)
3. Install it on your phones and link the sheet

You can skip part 2 if you only use one phone. The app works fully without sync, and your data stays on that device. Use Settings → Download backup now and then to keep a copy.

---

## 1. Put the app online with GitHub Pages

1. Create a free account at **github.com** if you don't have one.
2. Click **+** (top right) → **New repository**. Name it `receipt-book`, choose **Public**, and click **Create repository**.
   Free GitHub Pages sites need a public repository. Only the app's code is public; your expenses are never stored there.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `receipt-book.zip`. Open the `receipt-book` folder, select **everything inside it**, and drag it into the upload area. Click **Commit changes**.
   Upload the folder's contents, not the folder itself, so that `index.html` sits at the top level.
5. Go to **Settings → Pages**. Set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, and click **Save**.
6. After a minute or two, refresh that page. It shows your app's address, like `https://YOUR-NAME.github.io/receipt-book/`

---

## 2. Connect your Google Sheet

You'll add a small script to a Google Sheet. It saves your expenses and memos as rows and your receipt photos in a Google Drive folder. The script lives in your account, so it is the only thing your phone talks to.

Do this part on a computer; the Apps Script editor is hard to use on a phone.

### a. Create the sheet and add the script
1. Go to **sheets.new** to create a blank Google Sheet, and name it something like *Receipt Book*.
2. In the sheet's menu, choose **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete the few lines of sample code that are there. Open `google-sheet-sync.gs` from this folder in a text editor, copy everything, and paste it in.
4. Click the **Save** (disk) icon.

### b. Run the setup
1. Go back to the sheet tab and **reload the page**. A **Receipt Book** menu appears at the top after a few seconds.
2. Choose **Receipt Book → Set up sync**.
3. Google asks for permission. Click **Continue** and choose your account. You'll see *"Google hasn't verified this app"*. That's expected for a script you wrote or pasted yourself. Click **Advanced → Go to (your project) (unsafe)**, then **Allow**.
   The script asks for access to Sheets and Drive because it writes your expense rows and saves photos to a "Receipt Book photos" folder.
4. If no message appears after you allow access, choose **Receipt Book → Set up sync** again.
5. A message shows your **app key**, a long code. Copy it somewhere for a moment. You can see it again any time with **Receipt Book → Show app key**.

The sheet now has **Expenses**, **Memos** and **Settings** tabs.

### c. Publish the script as a web app
1. Back in the Apps Script tab, click **Deploy → New deployment**.
2. Click the gear next to *Select type* and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**, and allow access again if asked.
4. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.

"Anyone" lets your phone reach the script without signing in to Google. Without your app key, the script answers nothing, so keep the key private. If it ever leaks, use **Receipt Book → Make a new app key** and enter the new key on your devices.

---

## 3. Install on your phone and link the sheet

### iPhone or iPad
1. Open your app address in **Safari**. Home-screen install only works from Safari on iOS.
2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.

### Android
1. Open your app address in **Chrome**.
2. Tap **⋮** → **Install app** (or **Add to Home screen**).

### Link the sheet (once per device)
1. Open **Receipts** from your home screen and tap **Settings**.
2. Under *Sync with Google Sheet*, paste the **Web app URL** and the **App key**, then tap **Link sheet**.
3. Do the same on every other phone, tablet or computer you use.

The header shows *Synced with Google Sheet 14:32* when everything is up to date. If you're offline, changes wait on the phone and sync when you're back online. The app also syncs when you open it and every minute while it's open.

When you first link a phone that already has entries, it uploads all of them to the sheet.

---

## Using the sheet directly

You can work in the sheet as well as the app:

- **Change** any expense in the white columns (Date through Note). The app picks up the change next time it syncs.
- **Add** an expense by typing a new row with at least a **Date** and a **Total**. The sheet gives it an ID automatically.
- **Delete** an expense by selecting its cells from Date to Photos and pressing **Delete** to clear them. Don't right-click → *Delete row*; the app can't see that kind of deletion, so the expense would stay on your phones.
- **Memos** work the same way on the Memos tab.
- Leave the grey columns (ID, Photo IDs, Updated, Synced) and the tab names as they are; sync depends on them.
- The **Photos** column links to each receipt photo in your Drive's *Receipt Book photos* folder.
- **Items** are written as `name price; name x2 price`. Keep that pattern if you edit them.

---

## Using the app

- **Scan receipt:** take a photo or pick one. The app reads it on your phone and fills in what it can: shop, date, time, total, tax, payment method, category and items. **Always check the figures before saving.** Phone text reading gets totals and dates right most of the time but often misreads item names. To see what it read, open *Text found on the receipt*.
  - The first scan downloads the reading engine (about 10 MB). After that, it works offline.
  - For best results, lay the receipt flat in good light and fill the frame. Photograph long receipts in two parts and use **Add photo** for the second.
- **Day / Week / Month:** switch views at the top, and use **‹ ›** to move between periods. Tap a day in Week or Month view to open its memo.
- **Edit:** tap any entry. **Delete** offers Undo for a few seconds.
- **Memo:** each day has a free-text memo that saves as you type.
- **Budget:** set a monthly budget in Settings for the progress bar, the month-end projection and a daily allowance.
- **Other currencies:** type the code (USD, EUR…) and what it cost in your home currency.
- **Search** across shops, items, notes and memos, and **Export CSV** for the period you're viewing.
- **Backup:** Settings → *Download backup* saves everything, photos included, in one file. *Restore from backup* merges it back.

---

## Good to know

- **Speed:** Google's scripts take a few seconds per sync, and photos upload one at a time. Everything stays usable meanwhile.
- **Space:** photos use your Google Drive storage (15 GB free, shared with Gmail and Photos). Each receipt photo is roughly 150–250 KB.
- **Editing in two places at once:** if the same expense is changed on a phone and in the sheet before they sync, the most recent change wins.
- **Changing the script later:** after editing the code, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The web app URL stays the same.
- **Updating the app files:** upload the new files to GitHub, and change the `VERSION` line at the top of `sw.js` so phones fetch the update.

## What's in this folder

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `parse.js` | Turns the text read from a receipt into shop, date, total, items and so on |
| `google-sheet-sync.gs` | The script you paste into your Google Sheet for sync |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline use |
| `vendor/` | Tesseract.js (on-device text reading, Apache-2.0) with Japanese and English data |
