import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { guiHelp as commandHelp } from "../cli/command-help";
import { runGuiCommand } from "../cli/gui-cli";

export default class Gui extends Command {
	static description = commandHelp.description;
	static flags = {
		project: Flags.string({ char: "p", description: "Open this project directory" }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Gui);
		await runGuiCommand({ project: flags.project });
	}
}
