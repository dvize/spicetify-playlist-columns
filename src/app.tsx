import "./css/app.css";
import { PlaylistColumnsExtension } from "./lib/extension";

async function waitForApis() {
  while (!Spicetify?.React || !Spicetify?.ReactDOM || !Spicetify?.Platform?.PlaylistAPI || !Spicetify?.URI) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export default async function main() {
  await waitForApis();
  const extension = new PlaylistColumnsExtension();
  await extension.start();
}
