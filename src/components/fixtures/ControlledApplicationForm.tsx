"use client";

import { useEffect, useState } from "react";

const pages = [
  <><label htmlFor="name">Name</label><input id="name" name="name" required /><fieldset><legend>Can you attend all days?</legend><label><input type="radio" name="attendance" value="Yes" aria-label="Can you attend all days?" required />Yes</label><label><input type="radio" name="attendance" value="No" aria-label="Can you attend all days?" />No</label></fieldset><label><input id="consent" name="consent" type="checkbox" value="Yes" required />I consent to the code of conduct</label></>,
  <><label htmlFor="bio">Short bio</label><textarea id="bio" name="bio" required /></>,
  <><label htmlFor="github">GitHub profile</label><input id="github" name="github" type="url" required /><label htmlFor="resume">Upload your resume</label><input id="resume" name="resume" type="file" required /></>,
  <><label htmlFor="travel">Can you arrange travel?</label><select id="travel" name="travel" required defaultValue=""><option value="">Choose one</option><option>Yes</option><option>No</option></select></>,
];

export function ControlledApplicationForm() {
  const [page, setPage] = useState(1); const [submitted, setSubmitted] = useState(false); const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (submitted) return <main><h1>Fixture application received</h1><p data-testid="fixture-confirmation">Confirmation: FIXTURE-APPLICATION-2026</p></main>;
  return <main><h1>Controlled multi-page application</h1>{hydrated ? <span data-testid="fixture-ready" hidden /> : null}<p data-testid="fixture-page">Page {page} of {pages.length}</p><form onSubmit={(event) => event.preventDefault()}>{pages.map((content, index) => <fieldset key={index} hidden={page !== index + 1} data-fixture-page={index + 1}>{content}</fieldset>)}{page < pages.length ? <button type="button" data-fixture-next onClick={() => setPage(page + 1)}>Next</button> : <button type="button" data-fixture-final onClick={() => setSubmitted(true)}>Next</button>}</form></main>;
}
