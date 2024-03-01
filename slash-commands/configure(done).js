const fs = require('fs');
require('dotenv').config();

module.exports = {
  run: async ({ interaction }) => {
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
      await interaction.reply({ content: 'You need to be an administrator to use this command.', ephemeral: true });
      return;
    }

    const roleId = interaction.options.getString('role');
    process.env.TEAM_ROLE_ID = roleId;

    try {
      // Read the current .env file content
      const envContent = fs.readFileSync('.env', 'utf8');
      // Convert it to an array of lines
      let envLines = envContent.split('\n');
      // Update the TEAM_ROLE_ID line or add it if it doesn't exist
      const teamRoleIdIndex = envLines.findIndex(line => line.startsWith('TEAM_ROLE_ID='));
      if (teamRoleIdIndex !== -1) {
        // Update the existing line
        envLines[teamRoleIdIndex] = `TEAM_ROLE_ID=${roleId}`;
      } else {
        // Add a new line
        envLines.push(`TEAM_ROLE_ID=${roleId}`);
      }
      // Write the updated content back to the .env file
      fs.writeFileSync('.env', envLines.join('\n'));

      await interaction.reply({ content: `The team role ID has been updated to: ${roleId}`, ephemeral: true });
    } catch (error) {
      console.error('Error saving to .env file:', error);
      await interaction.reply({ content: 'There was an error updating the role ID. Please try again.', ephemeral: true });
    }
  },

  data: {
    name: 'configure',
    description: 'Configures the role ID for command permissions.',
    options: [
      {
        name: 'role',
        type: 3, // STRING type
        description: 'The new role ID to use for permission checks',
        required: true,
      },
    ],
  },
};