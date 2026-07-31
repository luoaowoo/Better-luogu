init();
setInterval(() => {
  if (location.href !== lastUrl) init();
  const root = document.getElementById(ROOT_ID);
  if (root) placeRoot(root);
  if (isHomePage() && !document.getElementById(POST_ROOT_ID)) mountPostOptimizer();
  if (isHomePage() && !document.getElementById(FRIEND_LINK_ID)) mountFriendLink();
  if (isHomePage() && !document.getElementById(FILTER_ROOT_ID)) mountFilteredRandom();
  if (isArticleEditorPage() && !document.getElementById(ARTICLE_ROOT_ID)) mountArticleOptimizer();
  updateProblemGate();
  positionProblemPopover();
}, 1000);
