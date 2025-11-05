'use strict';

// 🚀 ANABBPREV BLOG - PRODUCTION BOOTSTRAP
// Migration completed - WordPress posts already imported and published

module.exports = async ({ strapi }) => {
  console.log('🚀 ANABBPREV Blog - Production mode starting...');
  
  try {
    // Check if we have posts already (from migration)
    const postCount = await strapi.entityService.count('api::post.post');
    console.log(`📊 Found ${postCount} posts in database`);
    
    if (postCount > 0) {
      console.log('✅ Production ready - WordPress migration data loaded successfully!');
    } else {
      console.log('⚠️  No posts found - this is expected for a fresh deployment');
    }
    
    console.log('🎉 Bootstrap completed - ready for Strapi Cloud!');
  } catch (error) {
    console.log('❌ Error during bootstrap:', error.message);
    // Don't fail the bootstrap - continue anyway
  }
};