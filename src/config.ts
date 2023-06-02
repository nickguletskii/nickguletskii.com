import type { Site, SocialObjects } from "./types";

export const SITE: Site = {
  website: "https://nickguletskii.com/",
  author: "Nick Guletskii",
  desc: "Nick Guletskii's personal webpage and blog",
  title: "Nick Guletskii",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerPage: 10,
};

export const LOCALE = ["en-EN"]; // set to [] to use the environment default

export const LOGO_IMAGE = {
  enable: false,
  svg: true,
  width: 216,
  height: 46,
};

export const SOCIALS: SocialObjects = [
  {
    name: "Github",
    href: "https://github.com/nickguletskii",
    linkTitle: ` ${SITE.title} on Github`,
    active: true,
  },
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/in/nickguletskii/",
    linkTitle: `${SITE.title} on LinkedIn`,
    active: true,
  },
  {
    name: "Mail",
    href: "mailto:nick@nickguletskii.com",
    linkTitle: `Send an email to ${SITE.title}`,
    active: false,
  },
  {
    name: "GitLab",
    href: "https://gitlab.com/nickguletskii/",
    linkTitle: `${SITE.title} on GitLab`,
    active: false,
  },
];
