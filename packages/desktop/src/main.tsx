import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "@/lib/i18n/context";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing");

createRoot(root).render(
	<StrictMode>
		<LocaleProvider>
			<App />
		</LocaleProvider>
	</StrictMode>,
);
