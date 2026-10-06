import { getAllowedParentOrigins } from "@/lib/config";
import Chat from "./Chat";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Chat allowedParentOrigins={getAllowedParentOrigins()} />;
}
