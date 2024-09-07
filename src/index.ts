import { Hono } from "hono";
import { BskyAgent, RichText } from "@atproto/api";
import { MeiliSearch } from "meilisearch";

export interface Env {
  signs: KVNamespace;
  signBucket: R2Bucket;
  BLUESKY_HANDLE: string;
  BLUESKY_PASSWORD: string;
  SEARCH_HOST: string;
  SEARCH_KEY: string;
  SEARCH_INDEX: string;
}

interface AllSigns {
  imageCount: number;
  images: string[];
}
 

const app = new Hono();

app.get("/", async (c) => {
  return c.redirect("https://roadsign.pictures", 302);
});


export default {
  fetch: app.fetch,
  scheduled: async (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    const sendRandomSkeet = async (env: Env) => {
      let signsRawJson = await env.signs.get("quality");
      let allSigns = JSON.parse(signsRawJson ?? "{}") as AllSigns;

      let randomSign = getRandomJson(allSigns.images);

      let r2Reference = await env.signBucket.get(
        `${randomSign}/${randomSign}_m.jpg`,
      );

      // If item not found in R2 - then just return
      if (r2Reference == null) {
        return;
      }

      // Search for item in search index
      const searchClient = new MeiliSearch({
        host: env.SEARCH_HOST,
        apiKey: env.SEARCH_KEY,
      });

      const index = await searchClient.getIndex(env.SEARCH_INDEX);
      const item = await index.getDocument(randomSign);

      // If item is not found in index - just exit
      if (item == null) {
        return;
      }

      const title = item.title;
      const desc = item.description;

      const titleRt = new RichText({ text: title });

      let b = await r2Reference.blob();

      const agent = new BskyAgent({
        service: "https://bsky.social",
      });

      await agent.login({
        identifier: env.BLUESKY_HANDLE,
        password: env.BLUESKY_PASSWORD,
      });

      const { data } = await agent.uploadBlob(b);

      await agent.post({
        text: `${title}\n${desc}`,
        facets: [
          {
            index: {
              byteStart: 0,
              byteEnd: titleRt.length,
            },
            features: [
              {
                $type: "app.bsky.richtext.facet#link",
                uri: `https://roadsign.pictures/sign/${randomSign}`,
              },
            ],
          },
        ],
        embed: {
          $type: "app.bsky.embed.images",
          images: [
            {
              alt: title,
              image: data.blob,
            },
          ],
        },
        createdAt: new Date().toISOString(),
      });
    };
    ctx.waitUntil(sendRandomSkeet(env));
  },
};

const getRandomJson = (images: string[]) => {
  const imageLength = images.length;
  const randIndex = Math.floor(Math.random() * imageLength) as number;
  return images[randIndex];
};
