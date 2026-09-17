import { Disclosure } from "@argus/peacock";

/**
 * The one line everyone reads, and the part that would otherwise surprise them
 * — approving a tool call runs code on this Mac — one click away.
 */
export function ShareDisclosure({ deviceName }: { deviceName: string | null }) {
  return (
    <Disclosure
      summary={
        deviceName
          ? `Anyone you let in can watch this agent and drive it — and ${deviceName} — with you, until you end the huddle.`
          : "Anyone you let in can watch this agent and drive it with you, until you end the huddle."
      }
      toggleLabel="What a guest can do"
    >
      <ul>
        <li>
          Read the whole conversation — every message you send, the agent&apos;s
          replies, and the files and commands it touches.
        </li>
        <li>Send messages to this agent, exactly like you can.</li>
        <li>
          Approve the agent&apos;s tool calls, which runs code on this Mac.
        </li>
        <li>
          {deviceName
            ? `Drive ${deviceName} — tap, type, and take control from you.`
            : "Drive the device you have open, if you open one."}
        </li>
        <li>
          Nothing else. Your other agents, sessions and projects stay out of
          reach, and a guest&apos;s access dies with the huddle.
        </li>
      </ul>
    </Disclosure>
  );
}
