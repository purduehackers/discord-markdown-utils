# @purduehackers/discord-markdown-utils

A [remark](https://github.com/remarkjs/remark) plugin that parses Discord mention syntax into mdast nodes. Comes with rehype handlers for rendering them as HTML.

Also enables GFM autolink literals so plain URLs in Discord messages become links.

## Install

```sh
bun add @purduehackers/discord-markdown-utils
```

## Usage

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import {
	remarkDiscord,
	discordRemarkRehypeHandlers,
} from "@purduehackers/discord-markdown-utils";

const processor = unified()
	.use(remarkParse)
	.use(remarkDiscord, { resolver })
	.use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
	.use(rehypeStringify);

const html = String(await processor.process(discordMessage));
```

The plugin requires a `resolver` object that looks up display values for each
mention type by ID. You implement it against whatever data source you have — a
Discord API client, a database cache, etc.

### Providing a resolver

```ts
interface Resolver {
	user(mention: { type: "user"; id: string }): Promise<string | null>;
	role(mention: {
		type: "role";
		id: string;
	}): Promise<{ name: string; color?: string } | null>;
	channel(mention: { type: "channel"; id: string }): Promise<string | null>;
	emoji(mention: {
		type: "emoji";
		animated: boolean;
		name: string;
		id: string;
	}): Promise<string | null>;
	timestamp(mention: {
		type: "timestamp";
		date: Date;
	}): Promise<string | null>;
}
```

Each method receives the parsed mention and should return the resolved display value, or `null` if unknown. Returning `null` falls back to a default value (see below).

**Example using a discord.js `Guild`:**

```ts
import { type Guild, Colors } from "discord.js";

function makeResolver(guild: Guild): Resolver {
	return {
		async user({ id }) {
			const member = await guild.members.fetch(id).catch(() => null);
			return member?.displayName ?? null;
		},
		async role({ id }) {
			const role = await guild.roles.fetch(id).catch(() => null);
			if (!role) return null;
			return {
				name: role.name,
				color:
					role.color !== Colors.Default ? role.hexColor : undefined,
			};
		},
		async channel({ id }) {
			const channel = await guild.channels.fetch(id).catch(() => null);
			return channel?.name ?? null;
		},
		async emoji({ id }) {
			const emoji = await guild.emojis.fetch(id).catch(() => null);
			return emoji?.imageURL() ?? null;
		},
		async timestamp({ date }) {
			return date.toLocaleString("en-US", {
				timeZone: "America/New_York",
			});
		},
	};
}
```

## Supported Syntax

| Discord syntax       | Type            | Notes                              |
| -------------------- | --------------- | ---------------------------------- |
| `<@123>` / `<@!123>` | user mention    | `!` prefix is legacy               |
| `<@&123>`            | role mention    |                                    |
| `<#123>`             | channel mention |                                    |
| `<:name:123>`        | custom emoji    | static                             |
| `<a:name:123>`       | custom emoji    | animated                           |
| `<t:1700000000>`     | timestamp       | Unix seconds; format flags ignored |
| `</command:123>`     | slash command   |                                    |

## HTML Output

When using `discordRemarkRehypeHandlers` with `remark-rehype`, each mention type renders as seen in the table below.

This library makes no assumptions about the styling of each component. A class
is added to each element representing a Discord mention so you can style them
using CSS. For roles with colors, the role color is added a a custom property
(`--role-color`) so you can reference it in your own styles.

| Type                             | HTML                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| User                             | `<span class="discord-user">Display Name</span>`                                            |
| Role                             | `<span class="discord-role">Role Name</span>`                                               |
| Role (with color)                | `<span class="discord-role" style="--role-color: ...;">Role Name</span>`                    |
| Channel                          | `<span class="discord-channel">Channel Name</span>`                                         |
| Emoji                            | `<img src="..." alt="name" class="discord-emoji">`                                          |
| Emoji (fallback when `null` URL) | `<span class="discord-emoji">:name:</span>`                                                 |
| Timestamp                        | `<time datetime="2026-04-07T03:16:58.576Z" class="discord-timestamp">formatted date</time>` |
| Command                          | `<span class="discord-command">/command</span>`                                             |

## Fallback Values

When a resolver returns `null`, the plugin uses these defaults:

| Type      | Fallback                             |
| --------- | ------------------------------------ |
| User      | `unknown-user`                       |
| Role      | `unknown-role`                       |
| Channel   | `unknown-channel`                    |
| Emoji     | renders as `:name:` text             |
| Timestamp | ISO string from `Date.toISOString()` |

## AST Nodes

If you need access to the parsed nodes directly (without converting to HTML), all node types are exported:

```ts
import type {
	DiscordMentionNode,
	DiscordUserMentionNode,
	DiscordRoleMentionNode,
	DiscordChannelMentionNode,
	DiscordEmojiMentionNode,
	DiscordTimestampMentionNode,
	DiscordCommandMentionNode,
} from "@purduehackers/discord-markdown-utils";
```

Each node type is also declared in the `mdast` module's `RootContentMap`, so they work correctly with `unist-util-visit` and other mdast utilities.
