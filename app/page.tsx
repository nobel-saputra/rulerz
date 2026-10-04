"use client";

import dynamic from "next/dynamic";

const ChatClient = dynamic(() => import("./chat-client"), { ssr: false });

export default function Home() {
  return <ChatClient />;
}
