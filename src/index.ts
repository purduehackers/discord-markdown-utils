import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import type { Handler, State } from "mdast-util-to-hast";
import type { Plugin, Processor } from "unified";
import type {} from "remark-parse";
import { visit, SKIP } from "unist-util-visit";
import type { Root, RootContent, Text } from "mdast";
import type { Element } from "hast";

/**
 * Remark plugin to turn plain URLs into links.
 * Adapted from remark-gfm.
 */
function remarkAutolink(this: Processor) {
	const data = this.data();
	add("micromarkExtensions", gfmAutolinkLiteral());
	add("fromMarkdownExtensions", gfmAutolinkLiteralFromMarkdown());

	function add(field: Exclude<keyof typeof data, "settings">, value: any) {
		const list = data[field] ? data[field] : (data[field] = []);
		list.push(value);
	}
}

export type Mention =
	| { type: "user"; id: string }
	| { type: "role"; id: string }
	| { type: "channel"; id: string }
	| { type: "emoji"; animated: boolean; name: string; id: string }
	| { type: "timestamp"; date: Date }
	| { type: "command"; commandText: string; id: string };

export type DiscordUserMentionNode = {
	type: "discordUser";
	id: string;
	displayName: string;
};
export type DiscordRoleMentionNode = {
	type: "discordRole";
	id: string;
	name: string;
	color?: string;
};
export type DiscordChannelMentionNode = {
	type: "discordChannel";
	id: string;
	name: string;
};
export type DiscordEmojiMentionNode = {
	type: "discordEmoji";
	animated: boolean;
	name: string;
	id: string;
	url: string | null;
};
export type DiscordTimestampMentionNode = {
	type: "discordTimestamp";
	date: Date;
	dateString: string;
};
export type DiscordCommandMentionNode = {
	type: "discordCommand";
	id: string;
	commandText: string;
};

export type DiscordMentionNode =
	| DiscordUserMentionNode
	| DiscordRoleMentionNode
	| DiscordChannelMentionNode
	| DiscordEmojiMentionNode
	| DiscordTimestampMentionNode
	| DiscordCommandMentionNode;

declare module "mdast" {
	interface RootContentMap {
		discordUser: DiscordUserMentionNode;
		discordRole: DiscordRoleMentionNode;
		discordChannel: DiscordChannelMentionNode;
		discordEmoji: DiscordEmojiMentionNode;
		discordTimestamp: DiscordTimestampMentionNode;
		discordCommand: DiscordCommandMentionNode;
	}
}

// TypeScript doesn't have dependent typing, so we can't have a single function
// which returns different types based on the parameter type.
export interface Resolver {
	user(mention: Extract<Mention, { type: "user" }>): Promise<string | null>;
	role(
		mention: Extract<Mention, { type: "role" }>,
	): Promise<{ name: string; color?: string } | null>;
	channel(
		mention: Extract<Mention, { type: "channel" }>,
	): Promise<string | null>;
	emoji(mention: Extract<Mention, { type: "emoji" }>): Promise<string | null>;
	timestamp(
		mention: Extract<Mention, { type: "timestamp" }>,
	): Promise<string | null>;
}

type PositionedMention = {
	start: number;
	end: number;
	mention: Mention;
};

const patterns = {
	user: /<@!?(\d+)>/g,
	role: /<@&(\d+)>/g,
	channel: /<#(\d+)>/g,
	emoji: /<(a?):(\w+):(\d+)>/g,
	timestamp: /<t:(\d+)(?::[tTdDfFR])?>/g,
	// See https://docs.discord.com/developers/interactions/application-commands#application-command-object
	command: /<(\/[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}):(\d+)?>/gu,
} as const;

function findMentions(text: string): PositionedMention[] {
	const results: PositionedMention[] = [];

	for (const m of text.matchAll(patterns.user)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: { type: "user", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.role)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: { type: "role", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.channel)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: { type: "channel", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.emoji)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: {
				type: "emoji",
				animated: m[1] === "a",
				name: m[2]!,
				id: m[3]!,
			},
		});
	}
	for (const m of text.matchAll(patterns.timestamp)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: {
				type: "timestamp",
				date: new Date(parseInt(m[1]!, 10)),
			},
		});
	}
	for (const m of text.matchAll(patterns.command)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			mention: {
				type: "command",
				commandText: m[1]!,
				id: m[2]!,
			},
		});
	}

	return results.sort((a, b) => a.start - b.start);
}

function createNode(mention: Mention): DiscordMentionNode {
	switch (mention.type) {
		case "user":
			return {
				type: "discordUser",
				id: mention.id,
				displayName: "unknown-user",
			};
		case "role":
			return {
				type: "discordRole",
				id: mention.id,
				name: "unknown-role",
			};
		case "channel":
			return {
				type: "discordChannel",
				id: mention.id,
				name: "unknown-channel",
			};
		case "emoji":
			return {
				type: "discordEmoji",
				animated: mention.animated,
				name: mention.name,
				id: mention.id,
				url: null,
			};
		case "timestamp":
			return {
				type: "discordTimestamp",
				date: mention.date,
				dateString: mention.date.toISOString(),
			};
		case "command":
			return {
				type: "discordCommand",
				commandText: mention.commandText,
				id: mention.id,
			};
	}
}

async function resolveMention(
	resolver: Resolver,
	mention: Mention,
	mentionNode: DiscordMentionNode,
) {
	switch (mention.type) {
		case "user":
			const name = await resolver.user(mention);
			(mentionNode as DiscordUserMentionNode).displayName =
				name ?? "unknown-user";
			break;
		case "role":
			const role = await resolver.role(mention);
			(mentionNode as DiscordRoleMentionNode).name =
				role?.name ?? "unknown-role";
			(mentionNode as DiscordRoleMentionNode).color = role?.color;
			break;
		case "channel":
			const channel = await resolver.channel(mention);
			(mentionNode as DiscordChannelMentionNode).name =
				channel ?? "unknown-channel";
			break;
		case "emoji":
			(mentionNode as DiscordEmojiMentionNode).url =
				await resolver.emoji(mention);
			break;
		case "timestamp":
			const timestamp = await resolver.timestamp(mention);
			if (timestamp !== null) {
				(mentionNode as DiscordTimestampMentionNode).dateString =
					timestamp;
			}
			break;
		case "command":
			// Already filled in by createNode()
			break;
	}
}

function mentionSpan(
	state: State,
	node: DiscordMentionNode,
	className: string,
	text: string,
): Element {
	const result = {
		type: "element" as const,
		tagName: "span",
		properties: { className: [className] },
		children: [{ type: "text" as const, value: text }],
	};
	state.patch(node, result);
	return state.applyData(node, result);
}

export const discordRemarkRehypeHandlers: Record<
	DiscordMentionNode["type"],
	Handler
> = {
	discordUser: (state: State, node: DiscordUserMentionNode) =>
		mentionSpan(state, node, "discord-user", node.displayName),

	discordRole: (state: State, node: DiscordRoleMentionNode) => {
		const result = mentionSpan(state, node, "discord-role", node.name);
		if (node.color)
			result.properties.style = `--role-color: ${node.color};`;
		return result;
	},

	discordChannel: (state: State, node: DiscordChannelMentionNode) =>
		mentionSpan(state, node, "discord-channel", node.name),

	discordEmoji: (state: State, node: DiscordEmojiMentionNode) => {
		if (node.url) {
			const result = {
				type: "element" as const,
				tagName: "img",
				properties: {
					src: node.url,
					alt: node.name,
					className: ["discord-emoji"],
				},
				children: [],
			};
			state.patch(node, result);
			return state.applyData(node, result);
		}
		return mentionSpan(state, node, "discord-emoji", `:${node.name}:`);
	},

	discordTimestamp: (state: State, node: DiscordTimestampMentionNode) =>
		mentionSpan(state, node, "discord-timestamp", node.dateString),

	discordCommand: (state: State, node: DiscordCommandMentionNode) =>
		mentionSpan(state, node, "discord-command", node.commandText),
};

export interface DiscordOptions {
	resolver: Resolver;
}

function remarkDiscord(this: Processor, { resolver }: DiscordOptions) {
	remarkAutolink.call(this);

	return async (tree: Root) => {
		const promises: Promise<unknown>[] = [];

		visit(tree, "text", (node: Text, index, parent) => {
			if (index === undefined || parent === undefined) return;

			const mentions = findMentions(node.value);
			if (mentions.length === 0) return;

			const replacement: (RootContent | DiscordMentionNode)[] = [];
			let lastIndex = 0;

			for (const { start, end, mention } of mentions) {
				if (start > lastIndex) {
					replacement.push({
						type: "text",
						value: node.value.slice(lastIndex, start),
					});
				}
				const mentionNode = createNode(mention);
				replacement.push(mentionNode);
				if (mention.type !== "command")
					promises.push(
						resolveMention(resolver, mention, mentionNode),
					);
				lastIndex = end;
			}

			if (lastIndex < node.value.length) {
				replacement.push({
					type: "text",
					value: node.value.slice(lastIndex),
				});
			}

			(parent.children as (RootContent | DiscordMentionNode)[]).splice(
				index,
				1,
				...replacement,
			);
			return [SKIP, index + replacement.length];
		});

		await Promise.all(promises);
	};
}
remarkDiscord satisfies Plugin<[DiscordOptions], Root, Root>;

export default remarkDiscord;
