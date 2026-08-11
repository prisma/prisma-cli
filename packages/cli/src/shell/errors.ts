/** Moved out of the commander shell: the v8 CLI's execution paths must
 *  never reach into code the shell owns. Re-exported here so the shell
 *  and its controllers keep their import paths until they are deleted. */
export * from "../errors";
