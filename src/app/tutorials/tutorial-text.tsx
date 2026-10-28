import { splitTutorialText } from "@/lib/tutorial-text";
import "./tutorial-text.css";

export function TutorialText({ children, keywords }: { children: string; keywords?: string[] }) {
  return <>{splitTutorialText(children, keywords).map((part, index) => part.important
    ? <mark key={index} className="tutorial-keyword">{part.text}</mark>
    : part.text)}</>;
}
