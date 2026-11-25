# 13 · Could the rest of the page delay the button?

`step: web-streaming-mechanism` · Web: the button is there, the code is not · **7:50 → 8:40** (0:50)

**On screen:** tracks showing HTML arriving in chunks: catalogue immediately, recommendations after 3 s. A normal module waits for document parsing to finish and starts only after the recommendations.
**Purpose:** resolve the web puzzle. Connect three facts: the document remains unfinished until recommendations arrive → the normal module waits for the document → the button waits for recommendations. Immediately call this a hypothesis, and explain that an early code start does not yet prove the button works.

## Script

The server sends this page in chunks. The first chunk—the catalogue and the button—goes out immediately. Then the server keeps the connection open. It’s waiting for the recommendations so it can send them as part of the same document.

For the shopper, that’s good: the products appear immediately. But for the browser, the document is unfinished all that time.

The client code is loaded as a normal module: `script type="module"`. A script like that follows a rule: it runs after the browser has finished parsing the document. *(point to the orange track)*

Put those together. The document ends when the recommendations arrive. The code waits for the end of the document. So the button waits for the recommendations.

A block the shopper wasn’t even waiting for held up their button for almost three seconds.

*(pause)*

For now, that’s a hypothesis. If it’s right, the same module with the `async` attribute—which doesn’t wait for the end of the document—should start immediately. We’ve already seen that: 36 milliseconds. But code starting early doesn’t prove the button works. We need to click again and look at the list.

## Transition

> That’s exactly what we did. More than once.

## If asked

Script start time is not hydration duration. For the module rule, see MDN, “JavaScript modules,” the browser loading section.
