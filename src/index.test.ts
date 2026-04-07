import { test, expect, describe } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkDiscord, {
	discordRemarkRehypeHandlers,
	type Resolver,
	type DiscordMentionNode,
	type DiscordRoleMentionNode,
	type DiscordChannelMentionNode,
	type DiscordUserMentionNode,
	type DiscordEmojiMentionNode,
	type DiscordTimestampMentionNode,
} from "./index";
import type { Root } from "mdast";

// --- Mock resolver setup ---

const mockUsers: Record<string, string> = {
	"636701123620634653": "Ray .߆",
	"753840846549418024": "Kian",
} as const;
const mockRoles: Record<string, { name: string; color?: string }> = {
	"1012751663322382438": {
		name: "Organizer",
		color: "rgb(255, 221, 0)",
	},
	"1344066433172373656": { name: "Division Lead" },
} as const;
const mockChannels: Record<string, string> = {
	"904896819165814794": "🚢ship",
	"809628073896443904": "⚡lounge",
	"1481390237186785460": "ImTheSquid - cooking something up",
} as const;
const mockEmojis: Record<string, string> = {
	// :flooshed:
	"935623596628389908":
		"https://cdn.discordapp.com/emojis/935623596628389908.webp?size=64",
	// :hamter:
	"1473130550306017481":
		"https://cdn.discordapp.com/emojis/1473130550306017481.webp?size=64",
} as const;

const mockResolver: Resolver = {
	async user(mention) {
		return mockUsers[mention.id] ?? null;
	},
	async role(mention) {
		return mockRoles[mention.id] ?? null;
	},
	async channel(mention) {
		return mockChannels[mention.id] ?? null;
	},
	async emoji(mention) {
		return mockEmojis[mention.id] ?? null;
	},
	async timestamp(mention) {
		return mention.date.toLocaleString("en-US", {
			timeZone: "America/Indianapolis",
		});
	},
};

// --- Pipeline helpers ---

function makeAstProcessor() {
	return unified()
		.use(remarkParse)
		.use(remarkDiscord, { resolver: mockResolver });
}

function makeHtmlProcessor() {
	return unified()
		.use(remarkParse)
		.use(remarkDiscord, { resolver: mockResolver })
		.use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
		.use(rehypeStringify);
}

async function getNodes(markdown: string): Promise<DiscordMentionNode[]> {
	const proc = makeAstProcessor();
	const tree = (await proc.run(proc.parse(markdown))) as Root;
	const nodes: DiscordMentionNode[] = [];
	const para = tree.children[0];
	if (para?.type === "paragraph") {
		for (const child of para.children) {
			if (child.type.startsWith("discord")) {
				nodes.push(child as unknown as DiscordMentionNode);
			}
		}
	}
	return nodes;
}

async function getHtml(markdown: string): Promise<string> {
	return String(await makeHtmlProcessor().process(markdown));
}

// --- Tests ---

describe("mention parsing", () => {
	test("user mention", async () => {
		const [node] = await getNodes("<@753840846549418024>");
		expect(node).toMatchObject({
			type: "discordUser",
			id: "753840846549418024",
		});
	});

	test("user mention with legacy ! prefix", async () => {
		const [node] = await getNodes("<@!636701123620634653>");
		expect(node).toMatchObject({
			type: "discordUser",
			id: "636701123620634653",
		});
	});

	test("role mention", async () => {
		const [node] = await getNodes("<@&1012751663322382438>");
		expect(node).toMatchObject({
			type: "discordRole",
			id: "1012751663322382438",
		});
	});

	test("channel mention", async () => {
		const [node] = await getNodes("<#904896819165814794>");
		expect(node).toMatchObject({
			type: "discordChannel",
			id: "904896819165814794",
		});
	});

	test("static emoji", async () => {
		const [node] = await getNodes("<:flooshed:935623596628389908>");
		expect(node).toMatchObject({
			type: "discordEmoji",
			animated: false,
			name: "flooshed",
			id: "935623596628389908",
		});
	});

	test("animated emoji", async () => {
		const [node] = await getNodes("<a:hamter:1473130550306017481>");
		expect(node).toMatchObject({
			type: "discordEmoji",
			animated: true,
			name: "hamter",
			id: "1473130550306017481",
		});
	});

	test("timestamp", async () => {
		const [node] = await getNodes("<t:1700000000>");
		expect(node).toMatchObject({ type: "discordTimestamp" });
	});

	test("command mention", async () => {
		const [node] = await getNodes("</play:123456>");
		expect(node).toMatchObject({
			type: "discordCommand",
			commandText: "/play",
			id: "123456",
		});
	});

	test("multiple mentions in one paragraph", async () => {
		const nodes = await getNodes(
			"<@753840846549418024> and <#809628073896443904>",
		);
		expect(nodes).toHaveLength(2);
		expect(nodes[0]).toMatchObject({
			type: "discordUser",
			id: "753840846549418024",
		});
		expect(nodes[1]).toMatchObject({
			type: "discordChannel",
			id: "809628073896443904",
		});
	});
});

describe("default values (resolver returns null)", () => {
	test("unknown user falls back to 'unknown-user'", async () => {
		const [node] = await getNodes("<@000>");
		expect((node as DiscordUserMentionNode).displayName).toBe(
			"unknown-user",
		);
	});

	test("unknown role falls back to 'unknown-role'", async () => {
		const [node] = await getNodes("<@&000>");
		expect((node as DiscordRoleMentionNode).name).toBe("unknown-role");
	});

	test("unknown channel falls back to 'unknown-channel'", async () => {
		const [node] = await getNodes("<#000>");
		expect((node as DiscordChannelMentionNode).name).toBe(
			"unknown-channel",
		);
	});

	test("unknown emoji has null url", async () => {
		const [node] = await getNodes("<:shrug:000>");
		expect((node as DiscordEmojiMentionNode).url).toBeNull();
	});
});

describe("timestamp formatting", () => {
	test("formats date in America/Indianapolis timezone", async () => {
		const [node] = await getNodes("<t:1700000000>");
		expect((node as DiscordTimestampMentionNode).dateString).toBe(
			new Date(1700000000000).toLocaleString("en-US", {
				timeZone: "America/Indianapolis",
			}),
		);
	});
});

describe("HTML output", () => {
	test("known user renders display name", async () => {
		const html = await getHtml("<@753840846549418024>");
		expect(html).toContain('<span class="discord-user">Kian</span>');
	});

	test("unknown user renders fallback", async () => {
		const html = await getHtml("<@000>");
		expect(html).toContain(
			'<span class="discord-user">unknown-user</span>',
		);
	});

	test("known role renders name", async () => {
		const html = await getHtml("<@&1344066433172373656>");
		expect(html).toContain(
			'<span class="discord-role">Division Lead</span>',
		);
	});

	test("unknown role renders fallback", async () => {
		const html = await getHtml("<@&000>");
		expect(html).toContain(
			'<span class="discord-role">unknown-role</span>',
		);
	});

	test("role with color includes CSS variable", async () => {
		const html = await getHtml("<@&1012751663322382438>");
		expect(html).toContain("--role-color: rgb(255, 221, 0)");
		expect(html).toContain("Organizer");
	});

	test("role without color has no style attribute", async () => {
		const html = await getHtml("<@&1344066433172373656>");
		expect(html).not.toContain("style=");
	});

	test("known channel renders name", async () => {
		const html = await getHtml("<#1481390237186785460>");
		expect(html).toContain(
			'<span class="discord-channel">ImTheSquid - cooking something up</span>',
		);
	});

	test("unknown channel renders fallback", async () => {
		const html = await getHtml("<#000>");
		expect(html).toContain(
			'<span class="discord-channel">unknown-channel</span>',
		);
	});

	test("known emoji renders as img", async () => {
		const html = await getHtml("<:flooshed:935623596628389908>");
		expect(html).toContain(
			'<img src="https://cdn.discordapp.com/emojis/935623596628389908.webp?size=64"',
		);
		expect(html).toContain('alt="flooshed"');
	});

	test("unknown emoji falls back to :name:", async () => {
		const html = await getHtml("<:shrug:000>");
		expect(html).toContain(":shrug:");
	});

	test("command renders with commandText", async () => {
		const html = await getHtml("</play:123456>");
		expect(html).toContain('<span class="discord-command">/play</span>');
	});

	test("timestamp renders formatted date string", async () => {
		const html = await getHtml("<t:1700000000>");
		const date = new Date(1700000000000);
		const expected = date.toLocaleString("en-US", {
			timeZone: "America/Indianapolis",
		});
		expect(html).toContain(`<time `);
		expect(html).toContain(`datetime="${date.toISOString()}"`);
		expect(html).toContain(`class="discord-timestamp">${expected}`);
	});
});
