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

type Mention =
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

// prettier-ignore
type MentionToNode<T extends Mention> =
    T extends { type: "user" }      ? DiscordUserMentionNode :
    T extends { type: "role" }      ? DiscordRoleMentionNode :
    T extends { type: "channel" }   ? DiscordChannelMentionNode :
    T extends { type: "emoji" }     ? DiscordEmojiMentionNode :
    T extends { type: "timestamp" } ? DiscordTimestampMentionNode :
    T extends { type: "command" }   ? DiscordCommandMentionNode :
    never;

export type ResolverResult<T extends Mention> =
	| (T extends { type: "role" }
			? { name: string; color?: string } // roles have a name and color
			: string)
	| null;

export type Resolver = <T extends Mention>(
	node: T,
) => Promise<ResolverResult<T>>;

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
	command: /<([-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}):(\d+)?>/gu,
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
				animated: false,
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
			const name = await resolver(mention);
			(mentionNode as DiscordUserMentionNode).displayName =
				name ?? "unknown-user";
			break;
		case "role":
			const role = await resolver(mention);
			(mentionNode as DiscordRoleMentionNode).name =
				role?.name ?? "unknown-role";
			(mentionNode as DiscordRoleMentionNode).color = role?.color;
			break;
		case "channel":
			const channel = await resolver(mention);
			(mentionNode as DiscordChannelMentionNode).name =
				channel ?? "unknown-channel";
			break;
		case "emoji":
			(mentionNode as DiscordEmojiMentionNode).url =
				await resolver(mention);
			break;
		case "timestamp":
			const timestamp = await resolver(mention);
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
