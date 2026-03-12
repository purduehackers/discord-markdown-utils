import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import type { Plugin, Processor } from "unified";
import type {} from "remark-parse";
import { visit, SKIP } from "unist-util-visit";
import type { Root, RootContent, Text } from "mdast";

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
	| { type: "user" | "role" | "channel"; id: string }
	| {
			type: "emoji";
			animated: boolean;
			name: string;
			id: string;
	  }
	| { type: "timestamp"; epochSeconds: number }
	| { type: "command"; id: string; commandText: string };

const patterns = {
	user: /<@!?(\d+)>/g,
	role: /<@&(\d+)>/g,
	channel: /<#(\d+)>/g,
	emoji: /<(a?):(\w+):(\d+)>/g,
	timestamp: /<t:(\d+)(?::[tTdDfFR])?>/g,
	// See https://docs.discord.com/developers/interactions/application-commands#application-command-object
	command: /<([-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}):(\d+)?>/gu,
} as const;

export type DiscordMentionNode =
	| { type: "discordUser"; id: string }
	| { type: "discordRole"; id: string }
	| { type: "discordChannel"; id: string }
	| { type: "discordEmoji"; animated: boolean; name: string; id: string }
	| { type: "discordTimestamp"; epochSeconds: number }
	| { type: "discordCommand"; id: string; commandText: string };

type PositionedMention = {
	start: number;
	end: number;
	node: DiscordMentionNode;
};

function findMentions(text: string): PositionedMention[] {
	const results: PositionedMention[] = [];

	for (const m of text.matchAll(patterns.user)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			node: { type: "discordUser", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.role)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			node: { type: "discordRole", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.channel)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			node: { type: "discordChannel", id: m[1]! },
		});
	}
	for (const m of text.matchAll(patterns.emoji)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			node: {
				type: "discordEmoji",
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
			node: {
				type: "discordTimestamp",
				epochSeconds: parseInt(m[1]!, 10),
			},
		});
	}
	for (const m of text.matchAll(patterns.command)) {
		results.push({
			start: m.index!,
			end: m.index! + m[0].length,
			node: {
				type: "discordCommand",
				commandText: m[1]!,
				id: m[2] ?? "",
			},
		});
	}

	return results.sort((a, b) => a.start - b.start);
}

function remarkDiscord(this: Processor) {
	remarkAutolink.call(this);

	return (tree: Root) => {
		visit(tree, "text", (node: Text, index, parent) => {
			if (index === undefined || parent === undefined) return;

			const mentions = findMentions(node.value);
			if (mentions.length === 0) return;

			const replacement: (RootContent | DiscordMentionNode)[] = [];
			let lastIndex = 0;

			for (const { start, end, node: mentionNode } of mentions) {
				if (start > lastIndex) {
					replacement.push({
						type: "text",
						value: node.value.slice(lastIndex, start),
					});
				}
				replacement.push(mentionNode);
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
	};
}
remarkDiscord satisfies Plugin<[], Root, Root>;

export default remarkDiscord;
