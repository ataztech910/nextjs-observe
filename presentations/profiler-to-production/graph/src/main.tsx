import { createRoot } from "react-dom/client";
import { Presentation } from "./components/Presentation";
import "./styles.css";
import "./intro.css";
createRoot(document.getElementById("root")!).render(<Presentation />);
